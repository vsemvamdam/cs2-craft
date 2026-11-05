import { useEffect, useState } from 'react';
import { loadDB, loadPrices, type Indexed, type Prices } from './data';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [s, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    set((p) => ({ ...p, loading: true }));
    fn().then(
      (data) => alive && set({ data, error: null, loading: false }),
      (e) => alive && set({ data: null, error: String(e?.message || e), loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

let dbCache: Indexed | null = null;
let pricesCache: Prices | null = null;
export function useDB(): Indexed | null {
  const [db, set] = useState<Indexed | null>(dbCache);
  useEffect(() => {
    if (!db) loadDB().then((d) => { dbCache = d; set(d); });
  }, []);
  return db;
}
export function usePrices(): Prices | null {
  const [p, set] = useState<Prices | null>(pricesCache);
  useEffect(() => {
    if (!p) loadPrices().then((d) => { pricesCache = d; set(d); });
  }, []);
  return p;
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, set] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => set(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useLocal<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, set] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = (nv: T | ((p: T) => T)) => {
    set((prev) => {
      const next = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  return [v, update];
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (el) el.style.display = 'none'; }, 2200);
}
export async function copy(text: string, msg = 'Скопировано') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(msg);
  }
}
