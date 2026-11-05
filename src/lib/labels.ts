// Russian labels as used in the Russian CS2 client.
export const WEARS = [
  { short: 'FN', ru: 'Прямо с завода', en: 'Factory New', min: 0, max: 0.07, color: '#2bb673' },
  { short: 'MW', ru: 'Немного поношенное', en: 'Minimal Wear', min: 0.07, max: 0.15, color: '#86c440' },
  { short: 'FT', ru: 'После полевых испытаний', en: 'Field-Tested', min: 0.15, max: 0.38, color: '#e6c229' },
  { short: 'WW', ru: 'Поношенное', en: 'Well-Worn', min: 0.38, max: 0.45, color: '#f08a24' },
  { short: 'BS', ru: 'Закалённое в боях', en: 'Battle-Scarred', min: 0.45, max: 1, color: '#e5483b' },
];
export const wearOf = (f: number) => (f < 0.07 ? 0 : f < 0.15 ? 1 : f < 0.38 ? 2 : f < 0.45 ? 3 : 4);

export const RARITIES: Record<number, { ru: string; en: string; color: string }> = {
  0: { ru: 'Обычное', en: 'Default', color: '#a0a4ab' },
  1: { ru: 'Ширпотреб', en: 'Consumer Grade', color: '#b0c3d9' },
  2: { ru: 'Промышленное качество', en: 'Industrial Grade', color: '#5e98d9' },
  3: { ru: 'Армейское качество', en: 'Mil-Spec', color: '#4b69ff' },
  4: { ru: 'Запрещённое', en: 'Restricted', color: '#8847ff' },
  5: { ru: 'Засекреченное', en: 'Classified', color: '#d32ce6' },
  6: { ru: 'Тайное', en: 'Covert', color: '#eb4b4b' },
  7: { ru: 'Контрабанда', en: 'Contraband', color: '#e4ae39' },
  8: { ru: '★ Ножи и перчатки', en: 'Exceedingly Rare', color: '#e4ae39' },
};
// Sticker/charm rarities use a different ladder
export const STICKER_RARITY: Record<number, { ru: string; color: string }> = {
  0: { ru: 'Обычная', color: '#b0c3d9' },
  3: { ru: 'Высшего класса', color: '#4b69ff' },
  4: { ru: 'Примечательного типа', color: '#8847ff' },
  5: { ru: 'Экзотичного вида', color: '#d32ce6' },
  6: { ru: 'Экстраординарного типа', color: '#eb4b4b' },
  7: { ru: 'Контрабанда', color: '#e4ae39' },
};

export const CATEGORIES: Record<string, string> = {
  rifle: 'Винтовки',
  pistol: 'Пистолеты',
  smg: 'Пистолеты-пулемёты',
  heavy: 'Тяжёлое',
  knife: 'Ножи',
  gloves: 'Перчатки',
  equipment: 'Снаряжение',
};

export const STICKER_EFFECTS: Record<string, string> = {
  Other: 'Обычная',
  Holo: 'Голографическая',
  Foil: 'Металлическая (Foil)',
  Gold: 'Золотая',
  Glitter: 'Блестящая',
  Embroidered: 'Вышитая',
  Lenticular: 'Лентикулярная',
};

export const PHASE_RU: Record<string, string> = {
  'Phase 1': 'Фаза 1',
  'Phase 2': 'Фаза 2',
  'Phase 3': 'Фаза 3',
  'Phase 4': 'Фаза 4',
  Ruby: 'Ruby',
  Sapphire: 'Sapphire',
  'Black Pearl': 'Black Pearl',
  Emerald: 'Emerald',
};

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Russian names of the main pattern-sensitive finishes (as in the Russian Steam client) */
export const FINISH_RU: Record<string, string> = {
  'Case Hardened': 'Поверхностная закалка',
  Fade: 'Градиент',
  'Marble Fade': 'Мраморный градиент',
  Doppler: 'Волны',
  'Gamma Doppler': 'Гамма-волны',
  'Crimson Web': 'Кровавая паутина',
  Slaughter: 'Убийство',
  'Heat Treated': 'Термическая обработка',
};
export const rarityName = (rar: number, cat?: string) => (rar === 8 ? (cat === 'gloves' ? '★ Экстраординарного типа' : '★ Тайное') : RARITIES[rar]?.ru || '');
