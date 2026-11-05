// Town menu + name/avatar editor (same flow as Phúc's VanphongAI settings: name field, "Chọn hình" with Nữ/Nam tabs and the 20 presets).
import { useEffect, useState } from 'react';
import { Chibi, PRESETS } from './Avatar';
import { IconCroc, IconCross, IconEdit } from '../icons';
export interface Menu { key: string; label: string; x: number; y: number; look?: string; kind: 'agent' | 'ent'; id: string }
export function TownMenu({ m, onEdit, onThrow }: { m: Menu; onEdit: () => void; onThrow: () => void }) {
  return <div className="ctx" style={{ left: m.x, top: m.y }} onClick={(ev) => ev.stopPropagation()} data-testid="ctx-menu">
    <b>{m.label}</b>
    <button onClick={onEdit} data-testid="ctx-edit"><IconEdit />Đặt tên &amp; avatar</button>
    <button onClick={onThrow} className="danger" data-testid="ctx-throw"><IconCroc />Ném cho cá sấu</button>
  </div>;
}
export function Editor({ m, cur, onClose, onSave }: { m: Menu; cur?: { name?: string; look?: string }; onClose: () => void; onSave: (name: string, look?: string) => void }) {
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
