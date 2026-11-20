// Town menu + name/avatar editor (same flow as Phúc's VanphongAI settings: name field, an avatar picker with Female/Male tabs and the 20 presets).
import { useEffect, useState } from 'react';
import { Chibi, PRESETS } from './Avatar';
import { IconCroc, IconCross, IconEdit, IconEye } from '../icons';
export interface Menu { key: string; label: string; x: number; y: number; look?: string; kind: 'agent' | 'ent'; id: string }
export function TownMenu({ m, onEdit, onThrow, onLook }: { m: Menu; onEdit: () => void; onThrow: () => void; onLook?: () => void }) {
  return <div className="ctx" style={{ left: m.x, top: m.y }} onClick={(ev) => ev.stopPropagation()} data-testid="ctx-menu">
    <b>{m.label}</b>
    <button onClick={onEdit} data-testid="ctx-edit"><IconEdit />Name &amp; avatar</button>
    {onLook ? <button onClick={onLook} data-testid="ctx-look"><IconEye />See through their eyes</button> : null}
    <button onClick={onThrow} className="danger" data-testid="ctx-throw"><IconCroc />Throw to the crocodiles</button>
  </div>;
}
export function Editor({ m, cur, onClose, onSave }: { m: Menu; cur?: { name?: string; look?: string }; onClose: () => void; onSave: (name: string, look?: string) => void }) {
  const [name, setName] = useState(cur?.name ?? '');
  const [look, setLook] = useState<string | undefined>(cur?.look ?? m.look);
  const [gender, setGender] = useState<'male' | 'female'>(() => (look?.startsWith('female') ? 'female' : 'male'));
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="editor-back" onClick={(ev) => { ev.stopPropagation(); if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="editor" role="dialog" aria-modal="true" aria-label="Choose a name and avatar" data-testid="editor">
        <div className="editor-head"><h3>Name &amp; avatar</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><IconCross /></button></div>
        <label>Name<input value={name} maxLength={40} placeholder={m.label} onChange={(e) => setName(e.target.value)} autoFocus data-testid="editor-name" /></label>
        <div className="tabs">{(['female', 'male'] as const).map((g) => <button key={g} aria-pressed={gender === g} onClick={() => setGender(g)}>{g === 'female' ? 'Female' : 'Male'}</button>)}</div>
        <div className="preset-grid">{PRESETS.filter((p) => p.gender === gender).map((p) => <button key={p.id} className="preset" aria-pressed={look === p.id} onClick={() => setLook(p.id)} title={p.name} data-testid={`preset-${p.id}`}><Chibi id={p.id} size={52} /><span>{p.name}</span></button>)}</div>
        <div className="editor-foot"><button onClick={() => onSave('', undefined)}>Default</button><button className="primary" onClick={() => onSave(name, look)} data-testid="editor-save">Save</button></div>
      </div>
    </div>
  );
}
