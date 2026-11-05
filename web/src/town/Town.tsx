// 2D town around the office: roads, Crossian Cafe, a sidewalk trà đá stall, the crocodile pond, and side characters.
// The office floor (Office2D, sessions/agents unchanged) sits inside the building. Side characters are simulated here in the browser;
// IT Ops reads the server's monitor status (Prometheus HTTP API, or labelled demo, or "chưa cấu hình").
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentUI, OfficeState } from '../reducer';
import { Office2D, center } from '../Office2D';
import { BUILDING, CAFE, NOC, OFFICE_AT, POND, ROADS, TOWN, TRADA, pondCenter } from './map';
import { initialWorld, step, throwIntoPond, type Ent, type World } from './sim';
import { agentKey, loadLooks, saveLooks, setCurrentLooks, setIdent, type Looks } from './looks';
import { Chibi, PRESETS } from './Avatar';
import { CatSvg, CrocSvg, DogSvg } from './Critters';
import { IconBeer, IconCoffee, IconCroc, IconEdit, IconGlass, IconPulse, IconCross } from '../icons';

const store = typeof localStorage === 'undefined' ? undefined : localStorage;
const THROW_FLY = 900, THROW_EAT = 2600, RESPAWN = 20000;
type Menu = { key: string; label: string; x: number; y: number; agent?: AgentUI; ent?: Ent; look?: string };
export function Town({ s, now, selected, onSelect }: { s: OfficeState; now: number; selected?: string; onSelect?: (sid: string) => void }) {
  const [looks, setLooks] = useState<Looks>(() => loadLooks(store));
  useEffect(() => { setCurrentLooks(looks); saveLooks(store, looks); }, [looks]);
  const world = useRef<World>(initialWorld(Date.now()));
  const [, force] = useState(0);
  const itops = useRef(s.itops); itops.current = s.itops;
  useEffect(() => { const t = setInterval(() => { world.current = step(world.current, Date.now(), Math.random, itops.current); force((n) => n + 1); }, 200); return () => clearInterval(t); }, []);
  const [thrown, setThrown] = useState<Record<string, { t: number; x: number; y: number; name: string; look?: string }>>({});
  useEffect(() => { const gone = Object.entries(thrown).filter(([, v]) => now - v.t > RESPAWN); if (gone.length) setThrown((o) => { const n = { ...o }; for (const [k] of gone) delete n[k]; return n; }); }, [now, thrown]);
  const hidden = useMemo(() => new Set(Object.keys(thrown)), [thrown]);
  const [menu, setMenu] = useState<Menu>();
  const [editing, setEditing] = useState<Menu>();
  const box = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(1); const [fit, setFit] = useState(true);
  useEffect(() => { // compact: scale the town to the available width
    const wrap = box.current?.parentElement; if (!wrap) return;
    const upd = () => setZoom(fit ? Math.min(1, Math.max(0.3, (wrap.clientWidth - 2) / TOWN.w)) : 1);
    upd(); const ro = new ResizeObserver(upd); ro.observe(wrap); return () => ro.disconnect();
  }, [fit]);
  const openAgent = (a: AgentUI, cx: number, cy: number) => { const k = agentKey(a); setMenu({ key: k, label: looks[k]?.name ?? a.name, x: cx, y: cy, agent: a, look: looks[k]?.look }); };
  const openEnt = (e: Ent, cx: number, cy: number) => { const k = `npc:${e.id}`; setMenu({ key: k, label: looks[k]?.name ?? e.name, x: cx, y: cy, ent: e, look: looks[k]?.look ?? e.look }); };
  const throwIt = (m: Menu) => {
    setMenu(undefined);
    if (m.ent) { world.current = throwIntoPond(world.current, m.ent.id, Date.now()); return; }
    const a = m.agent!; const c = center(a.desk);
    setThrown((o) => ({ ...o, [a.id]: { t: Date.now(), x: OFFICE_AT.x + c.x, y: OFFICE_AT.y + c.y - 20, name: looks[agentKey(a)]?.name ?? a.name, look: looks[agentKey(a)]?.look } }));
  };
  const ents = world.current.ents;
  const eating = ents.some((e) => e.act === 'eaten') || Object.values(thrown).some((v) => now - v.t > THROW_FLY - 200 && now - v.t < THROW_EAT);
  const pc = pondCenter();
  return (<>
    <section className="town" ref={box} style={{ width: TOWN.w, height: TOWN.h, zoom }} data-testid="town" onClick={() => setMenu(undefined)}>
      {ROADS.map((r, i) => <div key={i} className={`road ${r.w > r.h ? 'road-h' : 'road-v'}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)}
      <div className="building" style={{ left: BUILDING.x, top: BUILDING.y, width: BUILDING.w, height: BUILDING.h }}><span className="building-sign">Văn phòng</span><i className="door" /></div>
      <div className="office-at" style={{ left: OFFICE_AT.x, top: OFFICE_AT.y }}>
        <Office2D s={s} now={now} selected={selected} onSelect={onSelect} hidden={hidden} looks={looks} onMenu={openAgent} />
      </div>
      <div className="cafe" style={{ left: CAFE.x, top: CAFE.y, width: CAFE.w, height: CAFE.h }} data-testid="cafe">
        <div className="awning" /><div className="cafe-sign"><IconCoffee size={16} />Crossian Cafe</div>
        <div className="counter" />{[0, 1, 2].map((i) => <i key={i} className="table" style={{ left: 30 + i * 62, top: 150 + (i % 2) * 34 }} />)}
      </div>
      <div className="trada" style={{ left: TRADA.x, top: TRADA.y, width: TRADA.w, height: TRADA.h }} data-testid="trada">
        <div className="trada-sign"><IconGlass size={14} />Trà đá vỉa hè</div><i className="trada-table" />
        {[0, 1, 2, 3].map((i) => <i key={i} className="stool" style={{ left: 14 + i * 46, top: 86 + (i % 2) * 6 }} />)}<i className="crate"><IconBeer size={12} /></i>
      </div>
      <div className="pond" style={{ left: POND.cx - POND.rx, top: POND.cy - POND.ry, width: POND.rx * 2, height: POND.ry * 2 }} data-testid="pond">
        <span className="pond-sign"><IconCroc size={14} />Hồ cá sấu</span>
        {[0, 1, 2].map((i) => <div key={i} className={`croc croc-${i}${eating && i === 0 ? ' croc-eat' : ''}`} style={eating && i === 0 ? { left: pc.x - (POND.cx - POND.rx) - 48, top: pc.y - (POND.cy - POND.ry) - 18 } : undefined}><CrocSvg open={eating && i === 0} /></div>)}
        {eating && <div className="splash" style={{ left: POND.rx - 30, top: POND.ry - 30 }}><i /><i /></div>}
      </div>
      <Noc s={s} />
      {ents.map((e) => <Character key={e.id} e={e} ident={looks[`npc:${e.id}`]} onMenu={openEnt} />)}
      {Object.entries(thrown).map(([id, v]) => {
        const t = now - v.t; if (t > THROW_EAT) return null;
        return <div key={id} className="thrown" data-testid="thrown" style={{ left: v.x, top: v.y, ['--dx' as any]: `${pc.x - v.x}px`, ['--dy' as any]: `${pc.y - v.y}px` }}>
          <div className="ent-body">{v.look ? <Chibi id={v.look} size={34} /> : <span className="letter">{v.name[0]}</span>}</div><div className="bubble small">Tha cho em!</div></div>;
      })}
      <button className="fit" onClick={(ev) => { ev.stopPropagation(); setFit(!fit); }} data-testid="town-fit">{fit ? '100%' : 'Vừa khung'}</button>
      <div className="town-hint">Chuột phải vào agent, bấm vào nhân vật phụ: đặt tên, chọn avatar, ném cho cá sấu</div>
    </section>
      {menu && <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(ev) => ev.stopPropagation()} data-testid="ctx-menu">
        <b>{menu.label}</b>
        <button onClick={() => { setEditing(menu); setMenu(undefined); }} data-testid="ctx-edit"><IconEdit />Đặt tên &amp; avatar</button>
        <button onClick={() => throwIt(menu)} className="danger" data-testid="ctx-throw"><IconCroc />Ném cho cá sấu</button>
      </div>}
      {editing && <Editor m={editing} cur={looks[editing.key]} onClose={() => setEditing(undefined)} onSave={(name, look) => { setLooks((l) => setIdent(l, editing.key, { name, look })); setEditing(undefined); }} />}
  </>);
}
const ACT_ICON: Partial<Record<Ent['act'], ReactNode>> = { drink: <IconCoffee size={12} />, beer: <IconBeer size={12} /> };
function Character({ e, ident, onMenu }: { e: Ent; ident?: { name?: string; look?: string }; onMenu: (e: Ent, x: number, y: number) => void }) {
  if (e.act === 'gone') return null;
  const animal = e.kind === 'dog' || e.kind === 'cat';
  const name = ident?.name ?? e.name, look = ident?.look ?? e.look;
  return (
    <div className={`ent ent-${e.kind} act-${e.act}${e.tx < e.x - 1 ? ' left' : ''}`} style={{ left: e.x, top: e.y }} data-testid={`ent-${e.id}`} data-act={e.act}
      onClick={(ev) => { ev.stopPropagation(); onMenu(e, ev.clientX, ev.clientY); }} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onMenu(e, ev.clientX, ev.clientY); }}>
      {e.say && <div className={`bubble small${e.kind === 'itops' && e.reported && e.act === 'chat' ? ' alert' : ''}`}>{e.say}</div>}
      <div className="ent-body">{e.kind === 'dog' ? <DogSvg /> : e.kind === 'cat' ? <CatSvg /> : look ? <Chibi id={look} size={34} /> : <span className="letter">{name[0]}</span>}</div>
      {e.act === 'fight' && e.kind === 'cat' && <div className="dust"><i /><i /><i /></div>}
      <div className={`tag${animal ? ' tag-animal' : ''}`}>{ACT_ICON[e.act]}{name}{name !== e.name && (e.kind === 'itops' || e.kind === 'architect') ? <small>{e.name}</small> : null}</div>
    </div>
  );
}
function Noc({ s }: { s: OfficeState }) {
  const st = s.itops;
  const label = !st || st.mode === 'unconfigured' ? 'chưa cấu hình' : st.state === 'alert' ? `${st.alerts.length} cảnh báo` : st.state === 'error' ? 'lỗi đọc metrics' : st.state === 'checking' ? 'đang kiểm tra…' : 'ổn định';
  const cls = !st || st.mode === 'unconfigured' ? 'idle' : st.state;
  return <div className={`noc noc-${cls}`} style={{ left: NOC.x - 70, top: NOC.y + 26 }} data-testid="noc" title={st?.endpoint ? `${st.endpoint} · ${st.query}` : 'Set OFFICE_PROMETHEUS_URL'}>
    <IconPulse size={14} /><span>Monitor{st?.mode === 'demo' ? ' (demo)' : st?.mode === 'prometheus' ? ' · Prometheus' : ''}: <b>{label}</b></span></div>;
}
function Editor({ m, cur, onClose, onSave }: { m: Menu; cur?: { name?: string; look?: string }; onClose: () => void; onSave: (name: string, look?: string) => void }) {
  const [name, setName] = useState(cur?.name ?? '');
  const [look, setLook] = useState<string | undefined>(cur?.look ?? m.look);
  const [gioi, setGioi] = useState<'nam' | 'nu'>(() => (look?.startsWith('nu') ? 'nu' : 'nam'));
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="editor-back" onClick={(ev) => { ev.stopPropagation(); if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="editor" role="dialog" aria-modal="true" aria-label="Đặt tên và chọn hình" data-testid="editor">
        <div className="editor-head"><h3>Đặt tên &amp; chọn hình</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng"><IconCross /></button></div>
        <label>Tên<input value={name} maxLength={40} placeholder={m.label} onChange={(e) => setName(e.target.value)} autoFocus data-testid="editor-name" /></label>
        <div className="tabs">{(['nu', 'nam'] as const).map((g) => <button key={g} aria-pressed={gioi === g} onClick={() => setGioi(g)}>{g === 'nu' ? 'Nữ' : 'Nam'}</button>)}</div>
        <div className="preset-grid">{PRESETS.filter((p) => p.gioi === gioi).map((p) => <button key={p.id} className="preset" aria-pressed={look === p.id} onClick={() => setLook(p.id)} title={p.ten} data-testid={`preset-${p.id}`}><Chibi id={p.id} size={52} /><span>{p.ten}</span></button>)}</div>
        <div className="editor-foot"><button onClick={() => onSave('', undefined)}>Mặc định</button><button className="primary" onClick={() => onSave(name, look)} data-testid="editor-save">Lưu</button></div>
      </div>
    </div>
  );
}
