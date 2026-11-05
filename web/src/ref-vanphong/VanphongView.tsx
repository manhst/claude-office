// Our glue: mounts the ported Vanphong scene (see ./NOTICE) and feeds it reducer state, plus the town menu and name/avatar editor.
import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../reducer';
import { VanphongScene, type MenuTarget } from './scene';
import { agentKey, loadLooks, saveLooks, setCurrentLooks, setIdent, type Looks } from '../town/looks';
import { Editor, TownMenu, type Menu } from '../town/Editor';
import { initialWorld } from '../town/sim';
import './vanphong.css';

const store = typeof localStorage === 'undefined' ? undefined : localStorage;
const CAST = Object.fromEntries(initialWorld(0).ents.map((e) => [e.id, e]));
export default function VanphongView({ s, now }: { s: OfficeState; now: number }) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<VanphongScene | null>(null);
  const [looks, setLooks] = useState<Looks>(() => { const l = loadLooks(store); setCurrentLooks(l); return l; });
  useEffect(() => { setCurrentLooks(looks); saveLooks(store, looks); }, [looks]);
  const [menu, setMenu] = useState<Menu>(); const [editing, setEditing] = useState<Menu>();
  const sRef = useRef(s); sRef.current = s;
  const looksRef = useRef(looks); looksRef.current = looks;
  useEffect(() => {
    const open = (m: MenuTarget) => {
      const l = looksRef.current;
      if (m.kind === 'agent') { const a = sRef.current.agents[m.id]; if (!a) return; const k = agentKey(a); setMenu({ ...m, key: k, label: l[k]?.name ?? a.name, look: l[k]?.look }); return; }
      const e = CAST[m.id]; if (!e) return; const k = `npc:${m.id}`; setMenu({ ...m, key: k, label: l[k]?.name ?? e.name, look: l[k]?.look ?? e.look });
    };
    const sc = new VanphongScene(host.current!, store, open); scene.current = sc; return () => { sc.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.update(s, now); }, [s, now, looks]);
  useEffect(() => { if (!menu) return; const c = () => setMenu(undefined); document.addEventListener('click', c); return () => document.removeEventListener('click', c); }, [menu]);
  return (<>
    <section className="stage3d stage-vp" data-testid="office-vanphong"><div className="vp3d-stage" ref={host} /></section>
    {menu && <TownMenu m={menu} onEdit={() => { setEditing(menu); setMenu(undefined); }} onThrow={() => { scene.current?.throwIt(menu); setMenu(undefined); }} />}
    {editing && <Editor m={editing} cur={looks[editing.key]} onClose={() => setEditing(undefined)} onSave={(name, look) => { setLooks((l) => setIdent(l, editing.key, { name, look })); setEditing(undefined); }} />}
  </>);
}
