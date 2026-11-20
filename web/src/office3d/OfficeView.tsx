// Our glue: mounts the ported Office scene (see ./NOTICE) and feeds it reducer state, plus the town menu and name/avatar editor.
import { useEffect, useRef, useState } from 'react';
import type { DeckState } from '../reducer';
import { OfficeScene, type MenuTarget } from './scene';
import { agentKey, loadLooks, saveLooks, setCurrentLooks, setIdent, type Looks } from '../town/looks';
import { Editor, TownMenu, type Menu } from '../town/Editor';
import { menuEnt } from '../town/sim';
import './office3d.css';

const store = typeof localStorage === 'undefined' ? undefined : localStorage;
/** paused: hidden behind another tab; the render loop stops but the scene (and its WebGL context) is kept. */
export default function OfficeView({ s, now, paused = false }: { s: DeckState; now: number; paused?: boolean }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<OfficeScene | null>(null);
  const [looks, setLooks] = useState<Looks>(() => { const l = loadLooks(store); setCurrentLooks(l); return l; });
  useEffect(() => { setCurrentLooks(looks); saveLooks(store, looks); }, [looks]);
  const [menu, setMenu] = useState<Menu>(); const [editing, setEditing] = useState<Menu>();
  const sRef = useRef(s); sRef.current = s;
  const looksRef = useRef(looks); looksRef.current = looks;
  useEffect(() => {
    const open = (m: MenuTarget) => {
      const l = looksRef.current;
      const x = Math.min(Math.max(8, m.x), Math.max(8, window.innerWidth - 200));
      const y = Math.min(Math.max(8, m.y), Math.max(8, window.innerHeight - 160));
      if (m.kind === 'agent') { const a = sRef.current.agents[m.id]; if (!a) return; const k = agentKey(a); setMenu({ ...m, x, y, key: k, label: l[k]?.name ?? a.name, look: l[k]?.look }); return; }
      const e = menuEnt(m.id); if (!e) return; const k = `npc:${m.id}`; setMenu({ ...m, x, y, key: k, label: l[k]?.name ?? e.name, look: l[k]?.look ?? e.look });
    };
    const sc = new OfficeScene(host.current!, store, open); scene.current = sc; return () => { sc.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.update(s, now); }, [s, now, looks]);
  useEffect(() => { scene.current?.setPaused(paused); if (paused) setMenu(undefined); }, [paused]);
  useEffect(() => { if (!menu) return; const c = () => setMenu(undefined); document.addEventListener('click', c); return () => document.removeEventListener('click', c); }, [menu]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing || paused) return;
      if (!scene.current?.isPov()) return;
      e.preventDefault(); scene.current.exitPov();
    };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [editing, paused]);
  const look = menu && scene.current?.canEnterPov(menu.kind, menu.id);
  return (<>
    <section className="stage3d stage-office3d" data-testid="office-view"><div className="office3d-stage" ref={host} /></section>
    {menu && <TownMenu m={menu} onEdit={() => { setEditing(menu); setMenu(undefined); }} onThrow={() => { scene.current?.throwIt(menu); setMenu(undefined); }} onLook={look ? () => { scene.current?.enterPov(menu.kind, menu.id); setMenu(undefined); } : undefined} />}
    {editing && <Editor m={editing} cur={looks[editing.key]} onClose={() => setEditing(undefined)} onSave={(name, look) => { setLooks((l) => setIdent(l, editing.key, { name, look })); setEditing(undefined); }} />}
  </>);
}
