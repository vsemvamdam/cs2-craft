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

type LpFile = { t: Record<string, string>; e: Record<string, string> };
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
