import { useEffect, useState } from 'react';
import { imgUrl } from './data';

/** team logos: Liquipedia logos of every team (public/data/logos.json, scripts/fetch-logos.mjs), then Valve's
 *  team-sticker art for the rest (public/data/team-logos.json, scripts/build-db.mjs) */
type LogoFile = { imgPrefix: string[]; logos: Record<string, string> };
const FILLER = new Set(['team', 'esports', 'esport', 'e', 'sports', 'gaming', 'clan', 'club', 'gg']);

/** same as teamKeys() in scripts/build-db.mjs */
export function teamKeys(name: string) {
  const words = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([words.join(''), words.filter((w) => !FILLER.has(w)).join('')].filter(Boolean))];
}

let fileP: Promise<LogoFile | null> | null = null;
function loadLogos() {
  if (!fileP) fileP = fetch(import.meta.env.BASE_URL + 'data/team-logos.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return fileP;
}

type LpFile = { t: Record<string, string>; e: Record<string, string>; p?: Record<string, string>; s?: Record<string, string> };
let lpP: Promise<LpFile | null> | null = null;
export function loadLpLogos() {
  if (!lpP) lpP = fetch(import.meta.env.BASE_URL + 'data/logos.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return lpP;
}
const LP_DIR = import.meta.env.BASE_URL + 'data/logos/';

export function useTeamLogos() {
  const [f, setF] = useState<LogoFile | null>(null);
  const [lp, setLp] = useState<LpFile | null>(null);
  useEffect(() => { loadLogos().then(setF); loadLpLogos().then(setLp); }, []);
  return (...names: (string | undefined)[]) => {
    if (!f && !lp) return null;
    for (const n of names) {
      if (!n) continue;
      const keys = teamKeys(n);
      for (const k of keys) if (lp?.t[k]) return LP_DIR + lp.t[k];
      for (const k of keys) if (f?.logos[k]) return imgUrl(f.logos[k], 64);
    }
    return null;
  };
}

/** tournament page (Liquipedia) → its icon */
export function useTourIcons() {
  const [lp, setLp] = useState<LpFile | null>(null);
  useEffect(() => { loadLpLogos().then(setLp); }, []);
  return (page?: string) => (page && lp?.e[page] ? LP_DIR + lp.e[page] : null);
}

/** team pages (public/data/teams, tools/teams/build_teams.py): index of slugs by team key */
export type TeamIndex = { updated: string; k: Record<string, string>; t: [string, string, number, number, number][] };
let tixP: Promise<TeamIndex | null> | null = null;
export function loadTeamIndex() {
  if (!tixP) tixP = fetch(import.meta.env.BASE_URL + 'data/teams/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return tixP;
}
/** (…names) → slug of the team page, or null */
export function useTeamSlug() {
  const [ix, setIx] = useState<TeamIndex | null>(null);
  useEffect(() => { loadTeamIndex().then(setIx); }, []);
  return (...names: (string | undefined)[]) => {
    if (!ix) return null;
    for (const n of names) if (n) for (const k of teamKeys(n)) if (ix.k[k]) return ix.k[k];
    return null;
  };
}
