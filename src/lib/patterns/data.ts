/**
 * Pattern-sensitive finish data for CS2 skins.
 *
 * Provenance (full list in ./SOURCES.md):
 *  - Finish/weapon coverage: ByMykel/CSGO-API (MIT), public/api/en/skins.json.
 *  - Russian finish titles: official CS2 Russian localization (csgo_russian, via
 *    ByMykel/counter-strike-file-tracker, MIT), i.e. the names shown on the Russian Steam market.
 *  - Doppler paint indexes and paint-kit rarity tiers: Valve items_game.txt
 *    (SteamDatabase/GameTracking-CS2), cross-checked with csfloat/extension (MIT).
 *  - Seed lists: only lists confirmed by at least two independent sources;
 *    every entry carries its source URLs.
 *
 * Nothing here is an official Valve statement about value; tiers are community conventions.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** What the UI can offer for a finish. */
export type PatternToolKind =
  /** Seed → fade % calculator (see ./fade.ts). */
  | 'fade'
  /** Phase picker / phase info (Doppler, Gamma Doppler). */
  | 'phases'
  /** "Is my seed on a known list?" lookup (NOTABLE_SEEDS). */
  | 'seedlist'
  /** Text explanation only: patterns matter, but no reliable public seed data. */
  | 'info';

export type PatternFinishName =
  | 'Case Hardened'
  | 'Heat Treated'
  | 'Fade'
  | 'Amber Fade'
  | 'Acid Fade'
  | 'Marble Fade'
  | 'Doppler'
  | 'Gamma Doppler'
  | 'Crimson Web'
  | 'Slaughter';

export interface PatternFinishInfo {
  /** Exact English finish name as on the Steam market. */
  readonly finish: PatternFinishName;
  /** Official Russian name from the CS2 localization (as on the Russian Steam market). */
  readonly titleRu: string;
  /** Common community/slang name in Russian, when it differs from the official one. */
  readonly aliasRu?: string;
  /** 1–3 sentences: what the seed changes and what collectors value. */
  readonly explanationRu: string;
  /** Optional caveat for the UI. */
  readonly noteRu?: string;
  readonly tool: PatternToolKind;
  /** Weapons (exact Steam names) that have this finish. */
  readonly weapons: readonly string[];
}

export type DopplerFinishName = 'Doppler' | 'Gamma Doppler';

export type DopplerPhaseName =
  | 'Phase 1'
  | 'Phase 2'
  | 'Phase 3'
  | 'Phase 4'
  | 'Ruby'
  | 'Sapphire'
  | 'Black Pearl'
  | 'Emerald';

/** Approximate share of drops of this finish, in percent. Valve has never published phase odds. */
export interface ApproxOdds {
  readonly minPercent: number;
  readonly maxPercent: number;
  readonly approximate: true;
}

export interface DopplerPhase {
  readonly finish: DopplerFinishName;
  readonly phase: DopplerPhaseName;
  readonly titleRu: string;
  readonly descriptionRu: string;
  /** Ruby, Sapphire, Black Pearl, Emerald. */
  readonly isGem: boolean;
  /**
   * Paint-kit rarity of the knife version in items_game.txt (official data):
   * numbered phases are "mythical", Ruby/Sapphire/Emerald "legendary", Black Pearl "ancient".
   * (Glock-18 | Gamma Doppler paint kits are all "legendary" and are not reflected here.)
   */
  readonly knifePaintKitRarity: 'mythical' | 'legendary' | 'ancient';
  /** Paint indexes of this phase (knives incl. Butterfly/Shadow Daggers/Talon variants, and Glock-18). */
  readonly paintIndexes: readonly number[];
  /** Approximate drop odds as commonly cited; null when no estimate is commonly cited. */
  readonly approxOdds: ApproxOdds | null;
  readonly oddsNoteRu: string;
}

export interface NotableSeedList {
  /** Stable id, e.g. "ak-47/case-hardened/t1". */
  readonly id: string;
  /** Exact Steam weapon name. */
  readonly weapon: string;
  readonly finish: PatternFinishName;
  /** Tier label in Russian, e.g. «Тир 1 — blue gem». */
  readonly tierRu: string;
  /** 1 = best tier for this item. */
  readonly rank: number;
  readonly seeds: readonly number[];
  readonly noteRu?: string;
  /** Pages / datasets that confirm this list (at least two independent ones). */
  readonly sources: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Weapon coverage (ByMykel/CSGO-API, MIT)                             */
/* ------------------------------------------------------------------ */

const KNIVES_CH = [
  'Bayonet',
  'Bowie Knife',
  'Butterfly Knife',
  'Classic Knife',
  'Falchion Knife',
  'Flip Knife',
  'Gut Knife',
  'Huntsman Knife',
  'Karambit',
  'Kukri Knife',
  'M9 Bayonet',
  'Navaja Knife',
  'Nomad Knife',
  'Paracord Knife',
  'Shadow Daggers',
  'Skeleton Knife',
  'Stiletto Knife',
  'Survival Knife',
  'Talon Knife',
  'Ursus Knife',
] as const;

const KNIVES_MARBLE_DOPPLER = [
  'Bayonet',
  'Bowie Knife',
  'Butterfly Knife',
  'Falchion Knife',
  'Flip Knife',
  'Gut Knife',
  'Huntsman Knife',
  'Karambit',
  'M9 Bayonet',
  'Navaja Knife',
  'Nomad Knife',
  'Paracord Knife',
  'Shadow Daggers',
  'Skeleton Knife',
  'Stiletto Knife',
  'Survival Knife',
  'Talon Knife',
  'Ursus Knife',
] as const;

const GAMMA_DOPPLER_WEAPONS = [
  'Bayonet',
  'Bowie Knife',
  'Butterfly Knife',
  'Falchion Knife',
  'Flip Knife',
  'Glock-18',
  'Gut Knife',
  'Huntsman Knife',
  'Karambit',
  'M9 Bayonet',
  'Shadow Daggers',
] as const;

/* ------------------------------------------------------------------ */
/* PATTERN_FINISHES                                                    */
/* ------------------------------------------------------------------ */

export const PATTERN_FINISHES: Readonly<Record<PatternFinishName, PatternFinishInfo>> = {
  'Case Hardened': {
    finish: 'Case Hardened',
    titleRu: 'Поверхностная закалка',
    explanationRu:
      'Сид задаёт, какой участок текстуры закалки ляжет на оружие, поэтому меняется доля синего, фиолетового и золотого. ' +
      'Дороже всего «blue gem» — почти сплошь синие экземпляры, особенно когда синий на видимой стороне ' +
      '(у AK-47 — верх ствольной коробки и магазин). Цена топовых сидов может в разы превышать обычную.',
    tool: 'seedlist',
    weapons: ['AK-47', 'Five-SeveN', 'MAC-10', 'Hydra Gloves', ...KNIVES_CH],
  },
  'Heat Treated': {
    finish: 'Heat Treated',
    titleRu: 'Термическая обработка',
    explanationRu:
      'Механика та же, что у «Поверхностной закалки»: сид меняет соотношение синего, фиолетового и золотого. ' +
      'Ценятся самые синие экземпляры, но устоявшихся тир-листов сидов, как у AK-47, мы не нашли.',
    tool: 'info',
    weapons: ['Desert Eagle', 'Five-SeveN'],
  },
  Fade: {
    finish: 'Fade',
    titleRu: 'Градиент',
    aliasRu: 'Фейд',
    explanationRu:
      'Сид поворачивает и сдвигает градиент на модели, поэтому меняется, сколько розового, фиолетового и жёлтого видно. ' +
      'Это принято выражать «процентом фейда» от 80 до 100%; дороже всего экземпляры около 100% («full fade»).',
    noteRu:
      'Проценты считаются тем же открытым алгоритмом, что у CSFloat, Skinport и CSGOSKINS.GG; ' +
      'у BUFF и CS.MONEY свои методики, и цифры могут отличаться. Для перчаток процент не рассчитывается.',
    tool: 'fade',
    weapons: [
      'AWP',
      'Glock-18',
      'M4A1-S',
      'MAC-10',
      'MP7',
      'R8 Revolver',
      'UMP-45',
      'Specialist Gloves',
      ...KNIVES_CH,
    ],
  },
  'Amber Fade': {
    finish: 'Amber Fade',
    titleRu: 'Янтарный градиент',
    explanationRu:
      'Как у «Градиента», сид поворачивает рисунок, и процент считается тем же алгоритмом. ' +
      'Коллекционеры ищут экземпляры с максимальным процентом.',
    tool: 'fade',
    weapons: ['AUG', 'Galil AR', 'MAC-10', 'P2000', 'R8 Revolver', 'Sawed-Off'],
  },
  'Acid Fade': {
    finish: 'Acid Fade',
    titleRu: 'Кислотный градиент',
    explanationRu:
      'Сид сдвигает и поворачивает градиент на SSG 08, поэтому меняется доля ярких цветов на видимой стороне. ' +
      'Процент считается тем же алгоритмом, что у «Градиента».',
    tool: 'fade',
    weapons: ['SSG 08'],
  },
  'Marble Fade': {
    finish: 'Marble Fade',
    titleRu: 'Мраморный градиент',
    explanationRu:
      'Сид определяет, какой участок мраморной текстуры попадёт на клинок; процента фейда у этого скина нет. ' +
      'Ценятся «Fire & Ice» — только красный и синий без жёлтого (Керамбит, Штык-нож, Складной нож, Нож с лезвием-крюком), ' +
      'а у Штык-ножа M9 — красный кончик («Red Tip»).',
    tool: 'seedlist',
    weapons: ['Specialist Gloves', ...KNIVES_MARBLE_DOPPLER],
  },
  Doppler: {
    finish: 'Doppler',
    titleRu: 'Волны',
    aliasRu: 'Доплер',
    explanationRu:
      'Фаза (Phase 1–4, Ruby, Sapphire, Black Pearl) — это отдельная раскраска со своим paint index, она определяется при выпадении; ' +
      'сид лишь сдвигает рисунок внутри фазы. Дороже всего «камни» — Ruby, Sapphire и Black Pearl.',
    tool: 'phases',
    weapons: KNIVES_MARBLE_DOPPLER,
  },
  'Gamma Doppler': {
    finish: 'Gamma Doppler',
    titleRu: 'Гамма-волны',
    aliasRu: 'Гамма Доплер',
    explanationRu:
      'Как у «Волн», фаза (Phase 1–4 или Emerald) — отдельная раскраска, а сид двигает рисунок внутри фазы. ' +
      'Дороже всего Emerald (сплошной зелёный); из обычных фаз чаще других ищут Phase 2.',
    tool: 'phases',
    weapons: GAMMA_DOPPLER_WEAPONS,
  },
  'Crimson Web': {
    finish: 'Crimson Web',
    titleRu: 'Кровавая паутина',
    explanationRu:
      'Сид определяет, сколько паутин окажется на клинке и где. Ценятся целые паутины по центру видимой стороны ' +
      '(у Керамбита — одна центральная, у Штык-ножа M9 — тройная), особенно с малым износом.',
    tool: 'info',
    weapons: [
      'CZ75-Auto',
      'Desert Eagle',
      'R8 Revolver',
      'SCAR-20',
      'Specialist Gloves',
      ...KNIVES_CH,
    ],
  },
  Slaughter: {
    finish: 'Slaughter',
    titleRu: 'Убийство',
    explanationRu:
      'Сид сдвигает пятнистый рисунок, и иногда пятна складываются в узнаваемые фигуры. Выше всего ценится «ромб» (Diamond), ' +
      'затем «ангел» (Angel) и «сердце» (Heart) на видимой стороне; один и тот же сид на разных ножах выглядит по-разному.',
    tool: 'info',
    weapons: ['Hand Wraps', ...KNIVES_CH],
  },
};

/* ------------------------------------------------------------------ */
/* DOPPLER_PHASES                                                      */
/* ------------------------------------------------------------------ */

export const DOPPLER_GEMS: readonly DopplerPhaseName[] = ['Ruby', 'Sapphire', 'Black Pearl', 'Emerald'];

const DOPPLER_ODDS_NOTE =
  'Valve не публикует шансы фаз. Обычно пишут, что Phase 1–4 вместе — около 90% выпадений и встречаются примерно одинаково часто.';
const GEM_ODDS_NOTE =
  'Valve не публикует шансы. Чаще всего называют «около 1–2%»; встречаются и оценки ниже (вплоть до ~0,1%).';
const GAMMA_ODDS_NOTE =
  'Valve не публикует шансы, и общепринятой оценки для Gamma Doppler нет. Фазы 1–4 считаются обычными, Emerald — редким.';

/** Where the approximate odds above come from (none of them official). */
export const DOPPLER_ODDS_SOURCES: readonly string[] = [
  'https://www.steamanalyst.com/guides/doppler-phases',
  'https://key-drop.com/blog/doppler-phases-cs2/',
  'https://skins.cash/blog/doppler-phases-cs2/',
  'https://steamcommunity.com/sharedfiles/filedetails/?id=431724158',
  'https://profilerr.net/csgo-doppler-phases-all-you-need-to-know/',
];

export const DOPPLER_PHASES: readonly DopplerPhase[] = [
  // --- Doppler ---
  {
    finish: 'Doppler',
    phase: 'Phase 1',
    titleRu: 'Фаза 1',
    descriptionRu: 'Тёмная, почти чёрная основа с фиолетовыми и синими разводами.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [418, 852],
    approxOdds: { minPercent: 20, maxPercent: 25, approximate: true },
    oddsNoteRu: DOPPLER_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Phase 2',
    titleRu: 'Фаза 2',
    descriptionRu: 'Клинок в основном розовый и фиолетовый.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [419, 618, 853],
    approxOdds: { minPercent: 20, maxPercent: 25, approximate: true },
    oddsNoteRu: DOPPLER_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Phase 3',
    titleRu: 'Фаза 3',
    descriptionRu: 'Самая тёмная фаза: тёмно-синий и чёрный с зеленоватыми оттенками.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [420, 854],
    approxOdds: { minPercent: 20, maxPercent: 25, approximate: true },
    oddsNoteRu: DOPPLER_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Phase 4',
    titleRu: 'Фаза 4',
    descriptionRu: 'Преимущественно яркий синий с небольшими фиолетовыми акцентами.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [421, 855],
    approxOdds: { minPercent: 20, maxPercent: 25, approximate: true },
    oddsNoteRu: DOPPLER_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Ruby',
    titleRu: 'Рубин (Ruby)',
    descriptionRu: 'Сплошной насыщенный красный без синего и фиолетового. Один из «камней».',
    isGem: true,
    knifePaintKitRarity: 'legendary',
    paintIndexes: [415],
    approxOdds: { minPercent: 1, maxPercent: 2, approximate: true },
    oddsNoteRu: GEM_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Sapphire',
    titleRu: 'Сапфир (Sapphire)',
    descriptionRu: 'Сплошной ярко-синий клинок без фиолетового. Один из «камней».',
    isGem: true,
    knifePaintKitRarity: 'legendary',
    paintIndexes: [416, 619],
    approxOdds: { minPercent: 1, maxPercent: 2, approximate: true },
    oddsNoteRu: GEM_ODDS_NOTE,
  },
  {
    finish: 'Doppler',
    phase: 'Black Pearl',
    titleRu: 'Чёрная жемчужина (Black Pearl)',
    descriptionRu: 'Тёмный фиолетово-чёрный с перламутровым переливом. Самый редкий вариант Doppler.',
    isGem: true,
    knifePaintKitRarity: 'ancient',
    paintIndexes: [417, 617],
    approxOdds: { minPercent: 1, maxPercent: 1, approximate: true },
    oddsNoteRu: 'Valve не публикует шансы. Чаще всего называют «около 1%».',
  },
  // --- Gamma Doppler ---
  {
    finish: 'Gamma Doppler',
    phase: 'Phase 1',
    titleRu: 'Фаза 1',
    descriptionRu: 'Бирюзовый и фиолетовый с сине-голубыми переливами и немного зелёного.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [569, 1120],
    approxOdds: null,
    oddsNoteRu: GAMMA_ODDS_NOTE,
  },
  {
    finish: 'Gamma Doppler',
    phase: 'Phase 2',
    titleRu: 'Фаза 2',
    descriptionRu: 'Почти весь клинок насыщенно-зелёный; самая «зелёная» и обычно самая ценная из фаз 1–4.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [570, 1121],
    approxOdds: null,
    oddsNoteRu: GAMMA_ODDS_NOTE,
  },
  {
    finish: 'Gamma Doppler',
    phase: 'Phase 3',
    titleRu: 'Фаза 3',
    descriptionRu: 'Голубовато-бирюзовый градиент.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [571, 1122],
    approxOdds: null,
    oddsNoteRu: GAMMA_ODDS_NOTE,
  },
  {
    finish: 'Gamma Doppler',
    phase: 'Phase 4',
    titleRu: 'Фаза 4',
    descriptionRu: 'Больше светло-зелёного, «лаймовый» оттенок.',
    isGem: false,
    knifePaintKitRarity: 'mythical',
    paintIndexes: [572, 1123],
    approxOdds: null,
    oddsNoteRu: GAMMA_ODDS_NOTE,
  },
  {
    finish: 'Gamma Doppler',
    phase: 'Emerald',
    titleRu: 'Изумруд (Emerald)',
    descriptionRu: 'Сплошной изумрудно-зелёный клинок. Единственный «камень» Gamma Doppler.',
    isGem: true,
    knifePaintKitRarity: 'legendary',
    paintIndexes: [568, 1119],
    approxOdds: null,
    oddsNoteRu:
      'Valve не публикует шансы. Поскольку «легендарный» вариант здесь один (а не два, как Ruby и Sapphire), ' +
      'его обычно считают чуть менее редким, чем Ruby или Sapphire, но цифр с консенсусом нет.',
  },
];

/* ------------------------------------------------------------------ */
/* NOTABLE_SEEDS                                                       */
/* ------------------------------------------------------------------ */

// Datasets used for cross-checking (seed numbers only; no code or data files copied):
const SRC_CSGOTRADER =
  'https://github.com/gergelyszabo94/csgo-trader-extension/blob/master/extension/src/utils/static/patterns.js';
const SRC_BLUEGEM_DATA = 'https://github.com/csfloat/extension/blob/master/data/bluegem.json';

const CH_T1 = 'Тир 1 — blue gem';
const CH_T2 = 'Тир 2 — blue gem';
const MF_T1 = 'Тир 1 — Max Fire & Ice';
const MF_T2 = 'Тир 2 — 2nd max Fire & Ice';
const MF_T3 = 'Тир 3 — 3rd max Fire & Ice';

const MF_MAX = [412] as const;
const MF_2ND = [16, 146, 241, 359, 393, 541, 602, 649, 688, 701] as const;
const MF_3RD = [152, 281, 292, 344, 628, 673, 743, 777, 792, 994] as const;
/** 3rd-max seeds every source agrees on for Bayonet (281, 344, 628 are disputed as Fake FI). */
const MF_3RD_CONSENSUS = [152, 292, 673, 743, 777, 792, 994] as const;

export const NOTABLE_SEEDS: readonly NotableSeedList[] = [
  // --- Case Hardened ---
  {
    id: 'ak-47/case-hardened/t1',
    weapon: 'AK-47',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [661, 151, 955, 321, 387, 670, 179],
    noteRu:
      '#661 повсеместно считается лучшим паттерном. У AK-47 смотрят на синий сверху ствольной коробки и на магазине.',
    sources: [
      'https://csgoskins.gg/blog/ak-47-case-hardened-blue-gem-seed-patterns',
      SRC_CSGOTRADER,
      SRC_BLUEGEM_DATA,
      'https://csdb.gg/ak-47-case-hardened-blue-gem-seed-patterns',
    ],
  },
  {
    id: 'ak-47/case-hardened/t2',
    weapon: 'AK-47',
    finish: 'Case Hardened',
    tierRu: CH_T2,
    rank: 2,
    seeds: [592, 4, 905, 13, 168, 429],
    noteRu: 'В некоторых списках #592 и #168 относят к тиру 1.',
    sources: ['https://csgoskins.gg/blog/ak-47-case-hardened-blue-gem-seed-patterns', SRC_CSGOTRADER, SRC_BLUEGEM_DATA],
  },
  {
    id: 'five-seven/case-hardened/t1',
    weapon: 'Five-SeveN',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [278, 690, 868, 363, 670],
    noteRu:
      '#278 и #690 обычно называют лучшими. #768 в одних списках тир 1, в других тир 2, поэтому здесь его нет.',
    sources: [
      'https://csgoskins.gg/blog/five-seven-case-hardened-blue-gem-seed-patterns',
      SRC_CSGOTRADER,
      'https://csdb.gg/blue-gem/five-seven/',
    ],
  },
  {
    id: 'karambit/case-hardened/t1',
    weapon: 'Karambit',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [387, 442, 269, 853, 776, 73, 902],
    noteRu:
      '#387 чаще всего называют лучшим. Состав тира 1 у источников разный; здесь только сиды, которые к тиру 1 относят все.',
    sources: [
      'https://csgoskins.gg/blog/karambit-case-hardened-blue-gem-seed-patterns',
      'https://csdb.gg/blue-gem/karambit/',
      'https://sellyourskins.com/blog/?p=4073',
      SRC_CSGOTRADER,
      SRC_BLUEGEM_DATA,
    ],
  },
  {
    id: 'butterfly-knife/case-hardened/t1',
    weapon: 'Butterfly Knife',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [182, 652, 398, 838, 29, 494],
    sources: [
      'https://csgoskins.gg/blog/butterfly-knife-case-hardened-blue-gem-seed-patterns',
      'https://profilerr.net/butterfly-case-hardened-blue-gem-patterns/',
      SRC_BLUEGEM_DATA,
    ],
  },
  {
    id: 'flip-knife/case-hardened/t1',
    weapon: 'Flip Knife',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [670, 321, 151, 592, 661, 555],
    sources: [
      'https://csgoskins.gg/blog/flip-knife-case-hardened-blue-gem-seed-patterns',
      SRC_CSGOTRADER,
      SRC_BLUEGEM_DATA,
    ],
  },
  {
    id: 'bayonet/case-hardened/t1',
    weapon: 'Bayonet',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [555, 592, 670, 151, 179],
    sources: [
      'https://csgoskins.gg/blog/bayonet-case-hardened-blue-gem-seed-patterns',
      'https://profilerr.net/bayonet-case-hardened-blue-gem-patterns/',
      SRC_CSGOTRADER,
      SRC_BLUEGEM_DATA,
    ],
  },
  {
    id: 'm9-bayonet/case-hardened/t1',
    weapon: 'M9 Bayonet',
    finish: 'Case Hardened',
    tierRu: CH_T1,
    rank: 1,
    seeds: [601, 417],
    noteRu: '#601 — лучший синий на лицевой стороне, #417 — лучший двусторонний.',
    sources: [
      'https://csgoskins.gg/blog/m9-bayonet-case-hardened-blue-gem-seed-patterns',
      'https://csdb.gg/blue-gem/m9-bayonet/',
      'https://sellyourskins.com/blog/?p=4075',
      SRC_CSGOTRADER,
    ],
  },

  // --- Marble Fade ---
  {
    id: 'karambit/marble-fade/t1',
    weapon: 'Karambit',
    finish: 'Marble Fade',
    tierRu: MF_T1,
    rank: 1,
    seeds: MF_MAX,
    sources: [
      'https://csgoskins.gg/blog/karambit-marble-fade-fire-and-ice-seed-patterns',
      'https://profilerr.net/karambit-fire-and-ice-iconic-cs2-knife-skin/',
      'https://steamdb.com/en/skins/cs2/patterns/marble-fade',
    ],
  },
  {
    id: 'karambit/marble-fade/t2',
    weapon: 'Karambit',
    finish: 'Marble Fade',
    tierRu: MF_T2,
    rank: 2,
    seeds: MF_2ND,
    sources: [
      'https://csgoskins.gg/blog/karambit-marble-fade-fire-and-ice-seed-patterns',
      'https://profilerr.net/karambit-fire-and-ice-iconic-cs2-knife-skin/',
      'https://steamdb.com/en/skins/cs2/patterns/marble-fade',
    ],
  },
  {
    id: 'karambit/marble-fade/t3',
    weapon: 'Karambit',
    finish: 'Marble Fade',
    tierRu: MF_T3,
    rank: 3,
    seeds: MF_3RD,
    sources: [
      'https://csgoskins.gg/blog/karambit-marble-fade-fire-and-ice-seed-patterns',
      'https://profilerr.net/karambit-fire-and-ice-iconic-cs2-knife-skin/',
    ],
  },
  {
    id: 'bayonet/marble-fade/t1',
    weapon: 'Bayonet',
    finish: 'Marble Fade',
    tierRu: MF_T1,
    rank: 1,
    seeds: MF_MAX,
    sources: [
      'https://csgoskins.gg/blog/bayonet-marble-fade-fire-and-ice-seed-patterns',
      'https://skin.land/blog/bayonet-marble-fade-patterns-guide/',
      SRC_CSGOTRADER,
    ],
  },
  {
    id: 'bayonet/marble-fade/t2',
    weapon: 'Bayonet',
    finish: 'Marble Fade',
    tierRu: MF_T2,
    rank: 2,
    seeds: MF_2ND,
    sources: [
      'https://csgoskins.gg/blog/bayonet-marble-fade-fire-and-ice-seed-patterns',
      'https://skin.land/blog/bayonet-marble-fade-patterns-guide/',
      SRC_CSGOTRADER,
    ],
  },
  {
    id: 'bayonet/marble-fade/t3',
    weapon: 'Bayonet',
    finish: 'Marble Fade',
    tierRu: MF_T3,
    rank: 3,
    seeds: MF_3RD_CONSENSUS,
    noteRu: '#281, #344 и #628 часть источников относит к Fake Fire & Ice, поэтому их здесь нет.',
    sources: [
      'https://csgoskins.gg/blog/bayonet-marble-fade-fire-and-ice-seed-patterns',
      'https://skin.land/blog/bayonet-marble-fade-patterns-guide/',
      SRC_CSGOTRADER,
    ],
  },
  {
    id: 'flip-knife/marble-fade/t1',
    weapon: 'Flip Knife',
    finish: 'Marble Fade',
    tierRu: MF_T1,
    rank: 1,
    seeds: MF_MAX,
    sources: ['https://csgoskins.gg/blog/flip-knife-marble-fade-fire-and-ice-seed-patterns', SRC_CSGOTRADER],
  },
  {
    id: 'flip-knife/marble-fade/t2',
    weapon: 'Flip Knife',
    finish: 'Marble Fade',
    tierRu: MF_T2,
    rank: 2,
    seeds: MF_2ND,
    sources: ['https://csgoskins.gg/blog/flip-knife-marble-fade-fire-and-ice-seed-patterns', SRC_CSGOTRADER],
  },
  {
    id: 'flip-knife/marble-fade/t3',
    weapon: 'Flip Knife',
    finish: 'Marble Fade',
    tierRu: MF_T3,
    rank: 3,
    seeds: MF_3RD,
    sources: ['https://csgoskins.gg/blog/flip-knife-marble-fade-fire-and-ice-seed-patterns', SRC_CSGOTRADER],
  },
  {
    id: 'gut-knife/marble-fade/t1',
    weapon: 'Gut Knife',
    finish: 'Marble Fade',
    tierRu: MF_T1,
    rank: 1,
    seeds: MF_MAX,
    sources: [
      'https://csgoskins.gg/blog/gut-knife-marble-fade-fire-and-ice-seed-patterns',
      'https://csdb.gg/gut-knife-marble-fade-fire-and-ice-seed-patterns',
      SRC_CSGOTRADER,
    ],
  },
  {
    id: 'gut-knife/marble-fade/t2',
    weapon: 'Gut Knife',
    finish: 'Marble Fade',
    tierRu: MF_T2,
    rank: 2,
    seeds: MF_2ND,
    sources: [
      'https://csgoskins.gg/blog/gut-knife-marble-fade-fire-and-ice-seed-patterns',
      'https://csdb.gg/gut-knife-marble-fade-fire-and-ice-seed-patterns',
      SRC_CSGOTRADER,
    ],
  },
  {
    id: 'm9-bayonet/marble-fade/t1',
    weapon: 'M9 Bayonet',
    finish: 'Marble Fade',
    tierRu: 'Тир 1 — Max Red Tip',
    rank: 1,
    seeds: [341, 348, 468, 520, 527, 575, 583, 601, 636, 714, 742, 763, 807, 892, 897, 910, 911, 961],
    noteRu:
      'У Штык-ножа M9 нет Fire & Ice: ценится красный кончик. #636 и #897 часто выделяют как лучшие. ' +
      'Здесь только сиды, которые совпадают в обоих источниках.',
    sources: ['https://skin.land/blog/best-m9-bayonet-marble-fade-patterns/', SRC_CSGOTRADER],
  },
];
