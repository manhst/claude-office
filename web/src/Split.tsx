import { useEffect, useRef } from 'react';
import { clampSplit, saveSplit, splitFromPointer } from './split';

/** Accessible column splitter between the map and the information sidebar. */
export function SplitGutter({ ratio, onChange }: { ratio: number; onChange: (r: number) => void }) {
  const el = useRef<HTMLButtonElement>(null);
  const live = useRef(ratio);
  live.current = ratio;

  useEffect(() => {
    const btn = el.current; if (!btn) return;
    let dragging = false;
    const main = () => btn.parentElement;
    const apply = (clientX: number) => {
      const box = main()?.getBoundingClientRect(); if (!box) return;
      const next = splitFromPointer(clientX, box.left, box.width);
      live.current = next; onChange(next);
    };
    const down = (e: PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      dragging = true; btn.classList.add('is-drag'); btn.setPointerCapture(e.pointerId); apply(e.clientX); e.preventDefault();
    };
    const move = (e: PointerEvent) => { if (dragging) apply(e.clientX); };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false; btn.classList.remove('is-drag');
      try { btn.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      saveSplit(live.current);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    return () => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
    };
  }, [onChange]);

  const nudge = (delta: number) => {
    const box = el.current?.parentElement?.getBoundingClientRect();
    const next = clampSplit(live.current + delta, box?.width ?? 0);
    live.current = next; onChange(next); saveSplit(next);
  };

  return (
    <button
      ref={el}
      type="button"
      className="split"
      data-testid="split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize map and information panels"
      aria-valuemin={45}
      aria-valuemax={82}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`${Math.round(ratio * 100)} percent map`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-0.02); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(0.02); }
        else if (e.key === 'Home') { e.preventDefault(); nudge(0.8 - live.current); }
      }}
    ><i /></button>
  );
}
