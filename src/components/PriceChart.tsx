import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, AreaSeries, LineSeries, HistogramSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { HistoryFile, Prices } from '../lib/data';
import { money, usePrefs } from '../lib/prefs';

const DAY0 = Date.UTC(2013, 0, 1);
const t = (d: number) => ((DAY0 + d * 86400000) / 1000) as UTCTimestamp;
const RANGES = [
  { k: '1m', ru: '1М', days: 31 },
  { k: '3m', ru: '3М', days: 92 },
  { k: '1y', ru: '1Г', days: 366 },
  { k: 'all', ru: 'Всё', days: 0 },
];

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function PriceChart({ hist, vk, prices }: { hist: HistoryFile | null; vk: string; prices: Prices | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { currency, theme } = usePrefs();
  const [range, setRange] = useState('all');
  const rate = currency === 'USD' ? 1 : prices?.rates?.[currency] || 1;
  const entry = hist?.[vk];
  const steam = entry?.p || [];
  const snaps = entry?.s || [];

  const stats = useMemo(() => {
    if (!steam.length) return null;
    let hi = steam[0], lo = steam[0], vol = 0;
    for (const p of steam) { if (p[1] > hi[1]) hi = p; if (p[1] < lo[1]) lo = p; vol += p[2]; }
    const first = steam[0], last = steam[steam.length - 1];
    return { hi, lo, first, last, vol };
  }, [steam]);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontFamily: 'Inter, system-ui, sans-serif', attributionLogo: true },
      grid: { vertLines: { color: 'transparent' }, horzLines: { color: css('--border') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      crosshair: { mode: 0 },
      localization: { locale: 'ru-RU', priceFormatter: (v: number) => money(Math.round((v * 100) / rate), prices, currency) },
    });
    chartRef.current = chart;
    const accent = css('--accent');
    if (steam.length) {
      const area = chart.addSeries(AreaSeries, { lineColor: accent, topColor: accent + '55', bottomColor: accent + '05', lineWidth: 2, priceLineVisible: false, title: 'Steam (медиана сделок)' });
      area.setData(steam.map(([d, c]) => ({ time: t(d), value: (c / 100) * rate })));
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', color: css('--surface-3'), priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(steam.map(([d, , v]) => ({ time: t(d), value: v })));
    }
    if (snaps.length) {
      const sl = snaps.filter((s) => s[1] != null);
      const sp = snaps.filter((s) => s[2] != null);
      if (sl.length && !steam.length) {
        const l = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceLineVisible: false, title: 'Steam (мин. лот)' });
        l.setData(sl.map((s) => ({ time: t(s[0]), value: (s[1]! / 100) * rate })));
      }
      if (sp.length) {
        const l = chart.addSeries(LineSeries, { color: css('--link'), lineWidth: 2, priceLineVisible: false, title: 'Skinport (мин.)' });
        l.setData(sp.map((s) => ({ time: t(s[0]), value: (s[2]! / 100) * rate })));
      }
    }
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [hist, vk, currency, theme, rate]);

  useEffect(() => {
    const chart = chartRef.current;
    const all = [...steam.map((p) => p[0]), ...snaps.map((s) => s[0])];
    if (!chart || !all.length) return;
    const last = Math.max(...all);
    const r = RANGES.find((x) => x.k === range)!;
    if (!r.days) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: t(Math.max(Math.min(...all), last - r.days)), to: t(last) });
  }, [range, hist, vk]);

  const has = steam.length || snaps.length;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row between">
        <div className="seg">
          {RANGES.map((r) => <button key={r.k} className={range === r.k ? 'on' : ''} onClick={() => setRange(r.k)}>{r.ru}</button>)}
        </div>
        {stats && (
          <div className="row small muted" style={{ gap: 16 }}>
            <span>Первая сделка: <b className="num">{new Date(DAY0 + stats.first[0] * 86400000).toLocaleDateString('ru-RU')}</b></span>
            <span>Макс.: <b className="num">{money(stats.hi[1], prices, currency)}</b></span>
            <span>Мин.: <b className="num">{money(stats.lo[1], prices, currency)}</b></span>
            <span>Продано: <b className="num">{stats.vol.toLocaleString('ru-RU')}</b></span>
          </div>
        )}
      </div>
      <div ref={ref} style={{ height: 320, display: has ? 'block' : 'none' }} />
      {!has && (
        <div className="notice">
          Истории для этого варианта пока нет. Ежедневные снимки цен копятся автоматически; полная история Steam с первой сделки загружается, когда в репозитории задан секрет <span className="kbd">STEAM_REFRESH_TOKEN</span> (см. README).
        </div>
      )}
      {has && currency !== 'USD' ? <div className="tiny faint">Steam ведёт историю в долларах; в {currency} пересчитано по сегодняшнему курсу.</div> : null}
    </div>
  );
}
