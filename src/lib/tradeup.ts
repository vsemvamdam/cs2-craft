// Trade-up ("craft") contract math for CS2 — rules as of November 2026:
//  * Weapon contract: 10 items of the same rarity (Consumer..Classified) -> 1 item of the next rarity.
//  * Gold contract (since 23 Oct 2025): 5 Covert items -> 1 knife or gloves from the gold pool
//    of an input's collection (case). StatTrak inputs -> StatTrak knife (gloves have no StatTrak).
//  * StatTrak and non-StatTrak can't be mixed. Since the 21 May 2026 update Souvenir items may be
//    mixed with normal ones; the result is always a normal-quality item.
//  * Each input is one "ticket": P(outcome) = Σ_inputs 1/N · 1/|pool of that input's collection|.
//  * Output float: every input float is normalized into its own range, the normalized values are
//    averaged and mapped onto the output's range: out = min + avg · (max − min).
import type { Indexed, Prices, Skin } from './data';
import { skinPrice, type Source } from './prefs';
import { wearOf } from './labels';

export type TUInput = { id: string; float: number; sv?: boolean; price?: number | null };
export type TUMode = 'weapon' | 'gold';
export type TUConfig = { mode: TUMode; st: boolean; inputs: TUInput[] };
export type Outcome = {
  skin: Skin;
  prob: number;
  float: number;
  wear: number;
  phase?: string;
  price: number | null;
  net: number | null;
  /** collection that produced the ticket(s) */
  cols: string[];
};
export type InputInfo = { input: TUInput; skin: Skin | undefined; col?: string; norm: number; price: number | null; problems: string[] };
export type TUResult = {
  need: number;
  rarity: number | null;
  inputs: InputInfo[];
  errors: string[];
  warnings: string[];
  valid: boolean;
  avgNorm: number;
  outcomes: Outcome[];
  cost: number | null;
  ev: number | null;
  evNet: number | null;
  profit: number | null;
  roi: number | null;
  profitChance: number;
  missingPrices: number;
  /** max average price per input that still breaks even */
  breakEven: number | null;
};

/** Valve does not publish Doppler phase odds — these presets are estimates. */
export const PHASE_PRESETS: Record<string, { ru: string; odds: Record<string, Record<string, number>> }> = {
  community: {
    ru: 'Оценка сообщества (гемы ≈1%)',
    odds: {
      Doppler: { 'Phase 1': 0.2425, 'Phase 2': 0.2425, 'Phase 3': 0.2425, 'Phase 4': 0.2425, Ruby: 0.01, Sapphire: 0.01, 'Black Pearl': 0.01 },
      'Gamma Doppler': { 'Phase 1': 0.2475, 'Phase 2': 0.2475, 'Phase 3': 0.2475, 'Phase 4': 0.2475, Emerald: 0.01 },
    },
  },
  market: {
    ru: 'По числу лотов на рынке',
    // share of listings on Steam (BP ≈ 829, Ruby ≈ 3.4k, Sapphire ≈ 4.7k, phases ≈ 5.1–6.9k)
    odds: {
      Doppler: { 'Phase 1': 0.18, 'Phase 2': 0.21, 'Phase 3': 0.18, 'Phase 4': 0.157, Ruby: 0.103, Sapphire: 0.143, 'Black Pearl': 0.027 },
      'Gamma Doppler': { 'Phase 1': 0.24, 'Phase 2': 0.24, 'Phase 3': 0.24, 'Phase 4': 0.24, Emerald: 0.04 },
    },
  },
  equal: { ru: 'Все фазы равновероятны', odds: {} },
};
export const PHASE_ODDS = PHASE_PRESETS.community.odds;

export const normFloat = (f: number, s: Skin) => (s.mx > s.mn ? Math.min(1, Math.max(0, (f - s.mn) / (s.mx - s.mn))) : 0);
export const outFloat = (avg: number, s: Skin) => s.mn + avg * (s.mx - s.mn);

/** Max average-normalized value that still gives each wear for this output skin. */
export function wearThresholds(s: Skin): { wear: number; maxAvg: number }[] {
  const bounds = [0.07, 0.15, 0.38, 0.45, 1];
  const out: { wear: number; maxAvg: number }[] = [];
  for (let w = 0; w < 5; w++) {
    const hi = bounds[w];
    const lo = w ? bounds[w - 1] : 0;
    if (s.mx <= lo || s.mn >= hi) continue;
    out.push({ wear: w, maxAvg: s.mx > s.mn ? Math.min(1, (hi - s.mn) / (s.mx - s.mn)) : 1 });
  }
  return out;
}

/** Outcome pool of one input in the given mode. */
export function poolFor(db: Indexed, skin: Skin, mode: TUMode, st: boolean): { col?: string; pool: Skin[] } {
  for (const col of skin.col) {
    if (mode === 'weapon') {
      const next = db.colTiers.get(col)?.get(skin.rar + 1) || [];
      if (next.length) return { col, pool: next };
    } else {
      const c = db.colById.get(col);
      const pool = (c?.gold || []).map((id) => db.alias.get(id)).filter((x): x is Skin => !!x);
      const uniq = [...new Set(pool)].filter((s) => (st ? s.cat === 'knife' : true));
      if (uniq.length) return { col, pool: uniq };
    }
  }
  return { col: skin.col[0], pool: [] };
}

export function canBeInput(s: Skin, mode: TUMode): boolean {
  if (s.gold || s.rar === 7 || s.cat === 'equipment' && s.rar === 0) return false;
  return mode === 'gold' ? s.rar === 6 : s.rar >= 1 && s.rar <= 5;
}

export function computeTradeUp(
  db: Indexed,
  prices: Prices | null,
  cfg: TUConfig,
  opts: { source: Source; fee: number; phases?: string; inputPrice?: (s: Skin, flag: '' | 's' | 'v', wear: number) => number | null },
): TUResult {
  const need = cfg.mode === 'gold' ? 5 : 10;
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: InputInfo[] = [];
  let rarity: number | null = null;
  const tickets: { col?: string; pool: Skin[] }[] = [];

  for (const input of cfg.inputs) {
    const skin = db.alias.get(input.id);
    const problems: string[] = [];
    if (!skin) {
      infos.push({ input, skin, norm: 0, price: null, problems: ['Предмет не найден'] });
      continue;
    }
    if (!canBeInput(skin, cfg.mode)) problems.push(cfg.mode === 'gold' ? 'Нужен предмет тайного качества (красный)' : 'Эта редкость не участвует в контракте');
    if (rarity == null) rarity = skin.rar;
    else if (skin.rar !== rarity) problems.push('Другая редкость — все предметы должны быть одной редкости');
    if (input.float < skin.mn - 1e-9 || input.float > skin.mx + 1e-9) problems.push(`Флоат вне диапазона скина (${skin.mn}–${skin.mx})`);
    if (cfg.st && !skin.st) problems.push('У этого скина нет версии StatTrak™');
    if (input.sv && cfg.st) problems.push('Сувенирные нельзя смешивать со StatTrak™');
    if (input.sv && !skin.sv) problems.push('У этого скина нет сувенирной версии');
    const t = poolFor(db, skin, cfg.mode, cfg.st);
    if (!t.pool.length) problems.push(cfg.mode === 'gold' ? (cfg.st ? 'В коллекции нет ножей StatTrak™ (только перчатки) — игра не примет' : 'У коллекции нет ножей/перчаток') : 'В коллекции нет предметов следующей редкости');
    tickets.push(t);
    const flag = cfg.st ? 's' : input.sv ? 'v' : '';
    const wear = wearOf(input.float);
    const price = input.price ?? (opts.inputPrice ? opts.inputPrice(skin, flag, wear) : skinPrice(prices, skin, flag, wear, opts.source));
    infos.push({ input, skin, col: t.col, norm: normFloat(input.float, skin), price, problems });
  }

  const n = cfg.inputs.length;
  if (n < need) warnings.push(`Добавьте ещё ${need - n} из ${need}`);
  if (n > need) errors.push(`В контракте должно быть ровно ${need} предметов`);
  for (const i of infos) for (const p of i.problems) if (!errors.includes(p)) errors.push(p);

  const avgNorm = infos.length ? infos.reduce((a, i) => a + i.norm, 0) / infos.length : 0;
  // outcome probabilities
  const map = new Map<string, Outcome>();
  if (n > 0) {
    for (const t of tickets) {
      if (!t.pool.length) continue;
      const share = 1 / n / t.pool.length;
      for (const s of t.pool) {
        const phases = s.phases?.length ? s.phases.map((p) => p.ph) : [undefined];
        const odds = s.phases?.length ? (PHASE_PRESETS[opts.phases || 'community'] || PHASE_PRESETS.community).odds[s.fin] : undefined;
        for (const ph of phases) {
          const pShare = ph ? share * (odds?.[ph] ?? 1 / phases.length) : share;
          const key = s.id + '|' + (ph || '');
          const o = map.get(key);
          if (o) {
            o.prob += pShare;
            if (t.col && !o.cols.includes(t.col)) o.cols.push(t.col);
          } else {
            const f = outFloat(avgNorm, s);
            map.set(key, { skin: s, prob: pShare, float: f, wear: wearOf(f), phase: ph, price: null, net: null, cols: t.col ? [t.col] : [] });
          }
        }
      }
    }
  }
  // normalize (tickets from dead collections are lost; the game would reject such a contract anyway)
  const total = [...map.values()].reduce((a, o) => a + o.prob, 0);
  const outcomes = [...map.values()];
  if (total > 0) for (const o of outcomes) o.prob /= total;
  const flagOut = cfg.st ? 's' : '';
  let missingPrices = 0;
  for (const o of outcomes) {
    o.price = skinPrice(prices, o.skin, flagOut, o.wear, opts.source, o.phase);
    if (o.price == null) missingPrices++;
    o.net = o.price == null ? null : o.price * (1 - opts.fee);
  }
  outcomes.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || b.prob - a.prob);

  const costKnown = infos.every((i) => i.price != null);
  const cost = infos.length && costKnown ? infos.reduce((a, i) => a + (i.price || 0), 0) : null;
  const priced = outcomes.filter((o) => o.price != null);
  const ev = priced.length && missingPrices === 0 ? outcomes.reduce((a, o) => a + o.prob * (o.price || 0), 0) : null;
  const evNet = ev == null ? null : ev * (1 - opts.fee);
  const profit = evNet != null && cost != null ? evNet - cost : null;
  const roi = profit != null && cost ? profit / cost : null;
  const profitChance = cost == null ? 0 : outcomes.reduce((a, o) => a + (o.net != null && o.net > cost ? o.prob : 0), 0);
  if (missingPrices) warnings.push(`Нет цены для ${missingPrices} исход(ов) — EV не посчитан`);
  if (cfg.mode === 'gold' && outcomes.some((o) => o.phase)) warnings.push('Шансы фаз Doppler приблизительные: Valve их не публикует');

  return {
    need, rarity, inputs: infos, errors, warnings,
    valid: n === need && errors.length === 0,
    avgNorm, outcomes, cost, ev, evNet, profit, roi, profitChance, missingPrices,
    breakEven: evNet != null && infos.length ? evNet / need : null,
  };
}

// ---- share links: compact encoding of a contract ----
export function encodeContract(cfg: TUConfig): string {
  const parts = cfg.inputs.map((i) => `${i.id.replace(/^skin-/, '')}~${+i.float.toFixed(6)}${i.sv ? '~v' : ''}${i.price != null ? '~p' + i.price : ''}`);
  return `${cfg.mode === 'gold' ? 'g' : 'w'}${cfg.st ? 's' : ''}:${parts.join(',')}`;
}
export function decodeContract(s: string | null): TUConfig | null {
  if (!s) return null;
  try {
    const [head, body = ''] = s.split(':');
    const rest = body.split(',');
    const mode: TUMode = head[0] === 'g' ? 'gold' : 'weapon';
    const st = head.includes('s');
    const inputs: TUInput[] = rest.filter(Boolean).map((p) => {
      const [id, f, ...flags] = p.split('~');
      const inp: TUInput = { id: 'skin-' + id, float: parseFloat(f) };
      for (const fl of flags) {
        if (fl === 'v') inp.sv = true;
        if (fl.startsWith('p')) inp.price = parseInt(fl.slice(1), 10);
      }
      return inp;
    });
    return { mode, st, inputs };
  } catch {
    return null;
  }
}
