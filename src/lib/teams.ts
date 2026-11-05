import { useEffect, useState } from 'react';
import { imgUrl } from './data';

/** team logos = Valve's team-sticker art (public/data/team-logos.json, built by scripts/build-db.mjs) */
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

export function useTeamLogos() {
  const [f, setF] = useState<LogoFile | null>(null);
  useEffect(() => { loadLogos().then(setF); }, []);
  return (...names: (string | undefined)[]) => {
    if (!f) return null;
    for (const n of names) {
      if (!n) continue;
      for (const k of teamKeys(n)) if (f.logos[k]) return imgUrl(f.logos[k], 64);
    }
    return null;
  };
}
