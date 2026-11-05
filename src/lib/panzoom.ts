import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pan & zoom for a square SVG radar (viewBox 0..size): mouse wheel / trackpad pinch, drag to pan,
 * two-finger pinch and drag on phones, double-click / double-tap to zoom in.
 * A click that ended a drag is swallowed, so markers aren't triggered by panning.
 */
export type View = { x: number; y: number; w: number };

export function usePanZoom(size = 1024, maxZoom = 10) {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, w: size });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; cx: number; cy: number; dist: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const anim = useRef(0);
  const lastType = useRef('mouse');

  const clamp = useCallback((v: View): View => {
    const w = Math.min(size, Math.max(size / maxZoom, v.w));
    const pad = w * 0.25;
    return { w, x: Math.min(size - w + pad, Math.max(-pad, v.x)), y: Math.min(size - w + pad, Math.max(-pad, v.y)) };
  }, [size, maxZoom]);

  /** client point → svg units for a given view */
  const toSvg = useCallback((cx: number, cy: number, v: View) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.w, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height };
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, factor: number, base?: View) => {
    const v = base || viewRef.current;
    const p = toSvg(cx, cy, v);
    const w = Math.min(size, Math.max(size / maxZoom, v.w / factor));
    setView(clamp({ w, x: p.x - p.fx * w, y: p.y - p.fy * w }));
  }, [toSvg, clamp, size, maxZoom]);

  /** smooth move to a view (used by buttons and «fit») */
  const animateTo = useCallback((target: View) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current, to = clamp(target), t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 260), e = 1 - (1 - k) ** 3;
      setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [clamp]);

  const zoomBy = useCallback((factor: number) => {
    const v = viewRef.current;
    const w = Math.min(size, Math.max(size / maxZoom, v.w / factor));
    animateTo({ w, x: v.x + (v.w - w) / 2, y: v.y + (v.w - w) / 2 });
  }, [animateTo, size, maxZoom]);
  const reset = useCallback(() => animateTo({ x: 0, y: 0, w: size }), [animateTo, size]);
  /** fit a box (svg units) with some padding, not closer than `maxFit`× */
  const fit = useCallback((x0: number, y0: number, x1: number, y1: number, maxFit = 3.5) => {
    const w = Math.max(size / maxFit, (Math.max(x1 - x0, y1 - y0)) * 1.35, 120);
    animateTo({ w, x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - w / 2 });
  }, [animateTo, size]);

  // wheel needs a non-passive listener to stop the page from scrolling
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const start = () => {
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { view: viewRef.current, cx, cy, dist, moved: gesture.current?.moved || false };
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      lastType.current = e.pointerType;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelAnimationFrame(anim.current);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) gesture.current = null;
      start();
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      const pts = [...pointers.current.values()];
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      if (!g.moved && Math.hypot(cx - g.cx, cy - g.cy) < 5 && pts.length < 2) return;
      if (!g.moved) {
        g.moved = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
      const r = ref.current!.getBoundingClientRect();
      const k = g.view.w / r.width;
      let v: View = { ...g.view, x: g.view.x - (cx - g.cx) * k, y: g.view.y - (cy - g.cy) * k };
      if (pts.length > 1 && g.dist > 0) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const factor = dist / g.dist;
        const p = toSvg(g.cx, g.cy, g.view);
        const w = Math.min(size, Math.max(size / maxZoom, g.view.w / factor));
        v = { w, x: p.x - ((cx - r.left) / r.width) * w, y: p.y - ((cy - r.top) / r.height) * w };
      }
      setView(clamp(v));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = gesture.current;
      pointers.current.delete(e.pointerId);
      if (g?.moved) swallowClick.current = true;
      if (pointers.current.size) { start(); return; }
      if (!g?.moved && e.pointerType !== 'mouse') {
        // double tap → zoom in
        const now = performance.now();
        const lt = lastTap.current;
        if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
          zoomAt(e.clientX, e.clientY, 2);
          lastTap.current = null;
          swallowClick.current = true;
        } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      }
      gesture.current = null;
    },
    onPointerCancel: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      gesture.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (swallowClick.current) {
        e.stopPropagation();
        e.preventDefault();
        swallowClick.current = false;
      }
    },
    onDoubleClick: (e: React.MouseEvent) => { if (lastType.current === 'mouse') zoomAt(e.clientX, e.clientY, 2); },
  };

  const k = size / view.w;
  return {
    ref, handlers, k, zoomBy, reset, fit,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.w}`,
    // one finger scrolls the page while the map isn't zoomed; once zoomed, gestures belong to the map
    touchAction: k > 1.02 ? 'none' : 'pan-y',
  };
}
