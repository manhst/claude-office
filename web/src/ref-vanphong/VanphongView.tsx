// Our glue: mounts the ported Vanphong scene (see ./NOTICE) and feeds it reducer state. Lazy-loaded chunk.
import { useEffect, useRef } from 'react';
import type { OfficeState } from '../reducer';
import { VanphongScene } from './scene';
import './vanphong.css';

const store = typeof localStorage === 'undefined' ? undefined : localStorage;
export default function VanphongView({ s, now }: { s: OfficeState; now: number }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<VanphongScene | null>(null);
  useEffect(() => { const sc = new VanphongScene(host.current!, store); scene.current = sc; return () => { sc.dispose(); scene.current = null; }; }, []);
  useEffect(() => { scene.current?.update(s, now); }, [s, now]);
  return <section className="stage3d stage-vp" data-testid="office-vanphong"><div className="vp3d-stage" ref={host} /></section>;
}
