import { useSyncExternalStore } from 'react';

// Hash router: works on GitHub Pages without server rewrites. URLs look like #/skin/<id>?w=2
export type Route = { path: string; parts: string[]; query: URLSearchParams };

function parse(): Route {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = h.split('?');
  const path = p || '/';
  return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}
let current = parse();
let currentKey = location.hash;
const subs = new Set<() => void>();
window.addEventListener('hashchange', () => {
  const prevPath = current.path;
  current = parse();
  currentKey = location.hash;
  if (current.path !== prevPath) window.scrollTo({ top: 0 });
  subs.forEach((f) => f());
});
export function useRoute(): Route {
  useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => currentKey);
  return current;
}
export function navigate(to: string, replace = false) {
  const h = to.startsWith('#') ? to : '#' + to;
  if (replace) history.replaceState(null, '', h), (current = parse()), (currentKey = location.hash), subs.forEach((f) => f());
  else location.hash = h;
}
/** update query params of the current route without adding history entries */
export function setQuery(params: Record<string, string | number | null | undefined>) {
  const q = new URLSearchParams(current.query);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') q.delete(k);
    else q.set(k, String(v));
  }
  const s = q.toString();
  navigate(current.path + (s ? '?' + s : ''), true);
}
export const href = (to: string) => '#' + to;
