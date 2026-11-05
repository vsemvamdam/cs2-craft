/**
 * Pattern (paint seed) data module for CS2 skins. Browser-safe, dependency-free.
 * See ./SOURCES.md for provenance and licenses.
 */

import {
  DOPPLER_PHASES,
  NOTABLE_SEEDS,
  PATTERN_FINISHES,
  type DopplerPhase,
  type DopplerPhaseName,
  type NotableSeedList,
  type PatternFinishInfo,
  type PatternFinishName,
  type PatternToolKind,
} from './data';
import { fadeSupported } from './fade';

export * from './data';
export * from './fade';

/** Text for the UI when the seed does not matter for a finish. */
export const NO_PATTERN_DIFFERENCE_RU = 'Паттерны у этого скина не отличаются';

export interface PatternInfo extends PatternFinishInfo {
  /** Normalised weapon name the info was resolved for. */
  readonly weapon: string;
  /**
   * The tool that actually applies to this weapon: e.g. "Fade" on Specialist Gloves
   * degrades from "fade" to "info" (no algorithm for gloves), and "seedlist" degrades
   * to "info" when no confirmed seed list exists for this weapon.
   */
  readonly effectiveTool: PatternToolKind;
  /** Confirmed seed lists for this exact weapon + finish, best tier first. */
  readonly seedLists: readonly NotableSeedList[];
  /** Phases for Doppler / Gamma Doppler; empty otherwise. */
  readonly phases: readonly DopplerPhase[];
  /** Phase parsed from the finish string ("Doppler Phase 2", "Doppler (Ruby)"), if any. */
  readonly phase: DopplerPhase | null;
}

const WEAR_SUFFIX = /\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/u;
const PHASE_SUFFIX = /\s*(?:\(\s*)?(Phase [1-4]|Ruby|Sapphire|Black Pearl|Emerald)(?:\s*\))?\s*$/u;

function normalizeWeapon(weaponName: string): string {
  return weaponName
    .replace(/^★\s*/u, '')
    .replace(/^StatTrak™\s*/u, '')
    .replace(/^Souvenir\s+/u, '')
    .trim();
}

function isPatternFinishName(name: string): name is PatternFinishName {
  return Object.prototype.hasOwnProperty.call(PATTERN_FINISHES, name);
}

/** Splits "Doppler Phase 2 (Factory New)" → { finish: "Doppler", phase: "Phase 2" }. */
function parseFinish(finishName: string): { finish: string; phase: DopplerPhaseName | null } {
  let finish = finishName.trim().replace(WEAR_SUFFIX, '');
  let phase: DopplerPhaseName | null = null;
  const m = PHASE_SUFFIX.exec(finish);
  if (m && /^(?:Gamma )?Doppler\b/u.test(finish)) {
    phase = m[1] as DopplerPhaseName;
    finish = finish.slice(0, m.index).trim();
  }
  return { finish, phase };
}

/** Confirmed seed lists for a weapon + finish, best tier first. */
export function getSeedLists(weaponName: string, finishName: string): readonly NotableSeedList[] {
  const weapon = normalizeWeapon(weaponName);
  const { finish } = parseFinish(finishName);
  return NOTABLE_SEEDS.filter((l) => l.weapon === weapon && l.finish === finish).sort((a, b) => a.rank - b.rank);
}

/** Best confirmed tier containing this seed, or null if the seed is on no known list. */
export function findSeedTier(weaponName: string, finishName: string, seed: number): NotableSeedList | null {
  if (!Number.isInteger(seed)) return null;
  return getSeedLists(weaponName, finishName).find((l) => l.seeds.includes(seed)) ?? null;
}

/** Phase by paint index (paint indexes are unique per phase across all Doppler weapons). */
export function getDopplerPhaseByPaintIndex(paintIndex: number): DopplerPhase | null {
  return DOPPLER_PHASES.find((p) => p.paintIndexes.includes(paintIndex)) ?? null;
}

/**
 * Pattern info for a weapon + finish, or null when the seed does not matter
 * for that finish (UI should then show NO_PATTERN_DIFFERENCE_RU).
 *
 * Accepts Steam-style names: weapon "★ Karambit" / "Karambit", finish "Fade",
 * "Fade (Factory New)", "Doppler Phase 2", "Gamma Doppler (Emerald)".
 * Returns null as well when the finish is pattern-sensitive but this weapon
 * does not have it (e.g. "AK-47" + "Fade").
 */
export function getPatternInfo(weaponName: string, finishName: string): PatternInfo | null {
  const weapon = normalizeWeapon(weaponName);
  const { finish, phase: phaseName } = parseFinish(finishName);
  if (!isPatternFinishName(finish)) return null;

  const info = PATTERN_FINISHES[finish];
  if (!info.weapons.includes(weapon)) return null;

  const seedLists = getSeedLists(weapon, finish);
  const phases =
    finish === 'Doppler' || finish === 'Gamma Doppler' ? DOPPLER_PHASES.filter((p) => p.finish === finish) : [];
  const phase = phaseName ? (phases.find((p) => p.phase === phaseName) ?? null) : null;

  let effectiveTool: PatternToolKind = info.tool;
  if (info.tool === 'fade' && !fadeSupported(weapon, finish)) effectiveTool = 'info';
  if (info.tool === 'seedlist' && seedLists.length === 0) effectiveTool = 'info';

  return { ...info, weapon, effectiveTool, seedLists, phases, phase };
}
