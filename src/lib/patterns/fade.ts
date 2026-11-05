/**
 * Fade percentage calculator for CS2 Fade-family finishes, keyed by paint seed.
 *
 * Ported from "csgo-fade-percentage-calculator" v2.0.0 by chescos
 *   https://github.com/chescos/csgo-fade-percentage-calculator
 *   (commit fd02dd14bb1d8d9ea39c15f5472a0745867369b2, npm 2.0.0)
 * which in turn ports Valve's uniform random number generator from
 * Step7750/UniformRandom (https://github.com/Step7750/UniformRandom).
 *
 * MIT License
 *
 * Copyright (c) 2022 chescos
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Changes vs. the original: merged into one module, configs keyed by finish
 * ("Fade" / "Amber Fade" / "Acid Fade"), lookups return null instead of
 * throwing, per-weapon tables are computed lazily and cached. The numeric
 * algorithm is unchanged (outputs are bit-identical to the original library).
 *
 * Fade % is a community convention: 80% = worst rotation, 100% = best.
 * Gloves (e.g. "Specialist Gloves | Fade") are NOT supported by the algorithm.
 * Marble Fade is a different finish and has no fade percentage.
 */

export type FadeFinish = 'Fade' | 'Amber Fade' | 'Acid Fade';

export interface FadeResult {
  /** 80..100 */
  percentage: number;
  /**
   * 1 = the best or the worst seed for this weapon (the original library ranks
   * from both ends: min(position from bottom, position from top)).
   */
  ranking: number;
}

interface PatternConfig {
  readonly xStart: number;
  readonly xEnd: number;
  readonly yStart: number;
  readonly yEnd: number;
  readonly rotStart: number;
  readonly rotEnd: number;
}

interface FinishCalculatorSpec {
  readonly weapons: readonly string[];
  readonly reversed: readonly string[];
  /** Weapons obtainable via trade-up contracts have seed 1000 as well (0..1000). */
  readonly tradeUp: readonly string[];
  readonly defaultConfig: PatternConfig;
  readonly overrides: Readonly<Record<string, PatternConfig>>;
}

const DEFAULT_FADE_CONFIG: PatternConfig = {
  xStart: -0.7,
  xEnd: -0.7,
  yStart: -0.7,
  yEnd: -0.7,
  rotStart: -55,
  rotEnd: -65,
};

const FADE_WEAPONS = [
  'AWP',
  'Bayonet',
  'Bowie Knife',
  'Butterfly Knife',
  'Classic Knife',
  'Falchion Knife',
  'Flip Knife',
  'Glock-18',
  'Gut Knife',
  'Huntsman Knife',
  'Karambit',
  'Kukri Knife',
  'M4A1-S',
  'M9 Bayonet',
  'MAC-10',
  'MP7',
  'Navaja Knife',
  'Nomad Knife',
  'Paracord Knife',
  'R8 Revolver',
  'Shadow Daggers',
  'Skeleton Knife',
  'Stiletto Knife',
  'Survival Knife',
  'Talon Knife',
  'UMP-45',
  'Ursus Knife',
] as const;

const AMBER_FADE_WEAPONS = ['AUG', 'Galil AR', 'MAC-10', 'P2000', 'R8 Revolver', 'Sawed-Off'] as const;

const ACID_FADE_WEAPONS = ['SSG 08'] as const;

const SPECS: Readonly<Record<FadeFinish, FinishCalculatorSpec>> = {
  Fade: {
    weapons: FADE_WEAPONS,
    reversed: ['AWP', 'Karambit', 'MP7', 'Talon Knife'],
    tradeUp: FADE_WEAPONS,
    defaultConfig: DEFAULT_FADE_CONFIG,
    overrides: {
      MP7: { xStart: -0.9, xEnd: -0.3, yStart: -0.7, yEnd: -0.5, rotStart: -55, rotEnd: -65 },
      'M4A1-S': { xStart: -0.14, xEnd: 0.05, yStart: 0, yEnd: 0, rotStart: -45, rotEnd: -45 },
    },
  },
  'Amber Fade': {
    weapons: AMBER_FADE_WEAPONS,
    reversed: [],
    tradeUp: AMBER_FADE_WEAPONS,
    defaultConfig: DEFAULT_FADE_CONFIG,
    overrides: {},
  },
  'Acid Fade': {
    weapons: ACID_FADE_WEAPONS,
    reversed: ['SSG 08'],
    tradeUp: ACID_FADE_WEAPONS,
    defaultConfig: { xStart: -2.4, xEnd: -2.1, yStart: 0, yEnd: 0, rotStart: -55, rotEnd: -65 },
    overrides: {},
  },
};

const MIN_PERCENTAGE = 80;

/** Valve's uniform RNG (Numerical Recipes ran1), as ported by chescos. */
class UniformRandom {
  private idum = 0;
  private iy = 0;
  private readonly iv: number[] = [];

  private static readonly NTAB = 32;
  private static readonly IA = 16807;
  private static readonly IM = 2147483647;
  private static readonly IQ = 127773;
  private static readonly IR = 2836;
  private static readonly NDIV = 1 + (UniformRandom.IM - 1) / UniformRandom.NTAB;
  private static readonly AM = 1.0 / UniformRandom.IM;
  private static readonly RNMX = 1.0 - 1.2e-7;

  constructor(seed: number) {
    this.idum = seed >= 0 ? -seed : seed;
    this.iy = 0;
  }

  private next(): number {
    const { NTAB, IA, IM, IQ, IR, NDIV } = UniformRandom;
    let k: number;
    let j: number;

    if (this.idum <= 0 || this.iy === 0) {
      if (-this.idum < 1) {
        this.idum = 1;
      } else {
        this.idum = -this.idum;
      }

      for (j = NTAB + 7; j >= 0; j -= 1) {
        k = Math.floor(this.idum / IQ);
        this.idum = Math.floor(IA * (this.idum - k * IQ) - IR * k);
        if (this.idum < 0) {
          this.idum += IM;
        }
        if (j < NTAB) {
          this.iv[j] = this.idum;
        }
      }
      this.iy = this.iv[0] as number;
    }

    k = Math.floor(this.idum / IQ);
    this.idum = Math.floor(IA * (this.idum - k * IQ) - IR * k);
    if (this.idum < 0) {
      this.idum += IM;
    }

    j = Math.floor(this.iy / NDIV);
    this.iy = Math.floor(this.iv[j] as number);
    this.iv[j] = this.idum;

    return this.iy;
  }

  randomFloat(low: number, high: number): number {
    let f = UniformRandom.AM * this.next();
    if (f > UniformRandom.RNMX) {
      f = UniformRandom.RNMX;
    }
    return f * (high - low) + low;
  }
}

function isFadeFinish(finish: string): finish is FadeFinish {
  return finish === 'Fade' || finish === 'Amber Fade' || finish === 'Acid Fade';
}

/**
 * Strips "★", "StatTrak™" and "Souvenir" prefixes. Names stay case-sensitive,
 * exactly as on the Steam market ("Karambit", "Glock-18", "SSG 08").
 */
function normalizeWeapon(weaponName: string): string {
  return weaponName.replace(/^★\s*/u, '').replace(/^StatTrak™\s*/u, '').replace(/^Souvenir\s+/u, '').trim();
}

function normalizeFinish(finish: string): string {
  // Tolerate a trailing wear suffix like "Fade (Factory New)".
  return finish.replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/u, '').trim();
}

const cache = new Map<string, readonly FadeResult[]>();

function computeTable(spec: FinishCalculatorSpec, weapon: string): readonly FadeResult[] {
  const config = spec.overrides[weapon] ?? spec.defaultConfig;
  const maxSeed = spec.tradeUp.includes(weapon) ? 1000 : 999;
  const usesRotation = config.rotStart !== config.rotEnd;
  const usesXOffset = config.xStart !== config.xEnd;

  const raw: number[] = [];
  for (let seed = 0; seed <= maxSeed; seed += 1) {
    const rng = new UniformRandom(seed);
    const xOffset = rng.randomFloat(config.xStart, config.xEnd);
    rng.randomFloat(config.yStart, config.yEnd); // y offset: consumed, unused
    const rotation = rng.randomFloat(config.rotStart, config.rotEnd);

    if (usesRotation && usesXOffset) {
      raw.push(rotation * xOffset); // e.g. MP7
    } else if (usesRotation) {
      raw.push(rotation); // most Fade skins
    } else {
      raw.push(xOffset); // e.g. M4A1-S
    }
  }

  const isReversed = spec.reversed.includes(weapon);
  // Equivalent to Math.min/max(...raw) without spreading 1001 args.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of raw) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const best = isReversed ? lo : hi;
  const worst = isReversed ? hi : lo;
  const range = worst - best;

  const normalized = raw.map((v) => (worst - v) / range);
  const sorted = [...normalized].sort((a, b) => a - b);
  // First index of each value in the sorted array (matches Array#indexOf semantics of the original).
  const firstIndex = new Map<number, number>();
  sorted.forEach((v, i) => {
    if (!firstIndex.has(v)) firstIndex.set(v, i);
  });

  return normalized.map((p) => {
    const idx = firstIndex.get(p) as number;
    return {
      percentage: MIN_PERCENTAGE + p * (100 - MIN_PERCENTAGE),
      ranking: Math.min(idx + 1, sorted.length - idx),
    };
  });
}

function getTable(finish: FadeFinish, weapon: string): readonly FadeResult[] | null {
  const spec = SPECS[finish];
  if (!spec.weapons.includes(weapon)) return null;
  const key = `${finish}|${weapon}`;
  let table = cache.get(key);
  if (!table) {
    table = computeTable(spec, weapon);
    cache.set(key, table);
  }
  return table;
}

/** True when a real seed→fade% algorithm exists for this weapon + finish. */
export function fadeSupported(weaponName: string, finish: string): boolean {
  const f = normalizeFinish(finish);
  if (!isFadeFinish(f)) return false;
  return SPECS[f].weapons.includes(normalizeWeapon(weaponName));
}

/**
 * Fade percentage for a paint seed (0..1000; seed 1000 exists only on trade-up-obtainable
 * skins, which is every weapon supported here). Returns null for unsupported weapon/finish
 * or an out-of-range / non-integer seed.
 */
export function getFadePercentage(weaponName: string, finish: string, seed: number): FadeResult | null {
  if (!Number.isInteger(seed) || seed < 0 || seed > 1000) return null;
  const f = normalizeFinish(finish);
  if (!isFadeFinish(f)) return null;
  const table = getTable(f, normalizeWeapon(weaponName));
  if (!table) return null;
  const row = table[seed];
  return row ? { percentage: row.percentage, ranking: row.ranking } : null;
}

/** Full per-seed table (index = seed), e.g. for "find best seeds" UIs. */
export function getFadeTable(weaponName: string, finish: string): readonly FadeResult[] | null {
  const f = normalizeFinish(finish);
  if (!isFadeFinish(f)) return null;
  return getTable(f, normalizeWeapon(weaponName));
}

/** Weapons supported per fade finish (exact Steam weapon names). */
export const FADE_SUPPORTED_WEAPONS: Readonly<Record<FadeFinish, readonly string[]>> = {
  Fade: SPECS.Fade.weapons,
  'Amber Fade': SPECS['Amber Fade'].weapons,
  'Acid Fade': SPECS['Acid Fade'].weapons,
};
