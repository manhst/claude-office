// Ours (not from the reference): the town around the Vanphong office, in the reference's voxel style (khoi/vatLieu/dungNguoi).
// Roads, Crossian Cafe, the sidewalk trà đá stall, the crocodile pond, the IT Ops monitoring kiosk, and the side characters
// (IT Ops indoors, NPCs, the dog Chos An, the cat Meow) driven by the pure town simulation (../town/sim.ts, plan px → world).
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ItOpsStatus } from '../types';
import { ATM, BBQ, BBQ_SEATS, BIA, BIA_SEATS, CAFE, GATE, GARDEN, GYM, ITOPS_SPOT, MASSAGE, MASSAGE_BEDS, POD, POND, PRINT, PX, ROADS, ROMANCE_SPOTS, SMOKE, TOWN, TRADA, pondCenter, toWorld, type Box } from '../town/map';
import { forceCrash, forceFire, initialTraffic, stepTraffic, onRoad, type Traffic } from '../town/traffic';
import { TrafficLayer } from './vehicles3d';
import { forceDrama, forceLayoff, forceRomance, initialWorld, knockDown, step, throwIntoPond, type AgentPrey, type Ent, type LayoffEvent, type World } from '../town/sim';
import { currentLook, currentName } from '../town/looks';
import { dungNguoi, khoi, vatLieu, vatLieuSang, type Hinh, type NgoaiHinh } from './characters';
import { MAU_SAN as PRESETS } from './nhanVat';
import { HeartFX } from './hearts';
import { VP_LABELS_EVENT, applyLabelVisibility, isLabelOn, loadLabels, monitorLabelVisible, type LabelKey } from '../vpLabels';

export interface TownCtx {
  nhom: THREE.Group; soft: boolean; own: <T extends { dispose(): void }>(m: T) => T;
  lights: THREE.PointLight[]; shades: THREE.MeshLambertMaterial[];
  plant: (cha: THREE.Object3D, x: number, z: number, co?: number) => void;
}
/** World bounds of the whole town (camera fit + pan limits). */
const [TX0, TZ0] = toWorld({ x: 0, y: TOWN.y0 }), [TX1, TZ1] = toWorld({ x: TOWN.w, y: TOWN.h });
export const CANH = { x0: TX0, x1: TX1, z0: TZ0, z1: TZ1 };
export const presetLook = (id?: string): NgoaiHinh | undefined => (PRESETS as { id: string; ngoai_hinh: NgoaiHinh }[]).find((p) => p.id === id)?.ngoai_hinh;
const ICON = {
  coffee: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7h1a2 2 0 0 1 0 4h-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  glass: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h8l-1.2 10H5.2zM4.4 6.5h7.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  croc: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 9.5c2-2 5-2.5 8-2l4.5-1.5-1 2.5 1 1.5-4.5-.5c-3 1.5-6 1.5-8 0z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  spa: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2c2 2.5 2 5 0 7-2-2-2-4.5 0-7zM2 8c2.5 0 4.5 1.2 6 3.5C9.5 9.2 11.5 8 14 8c0 3.5-2.7 6-6 6S2 11.5 2 8z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  pulse: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8.5h3l1.5-3 2 6 1.5-3h5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  grill: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6h10v1.5H3zm1 2.5h8v5H4zm2-4.5h4v1.5H6z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 5.5V3.5M8 5.5V2.5M11 5.5V3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  flower: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 2.5c1.2 1.5 1.2 3.2 0 4.5-1.2-1.3-1.2-3 0-4.5zm0 6.5c1.2 1.5 1.2 3.2 0 4.5-1.2-1.3-1.2-3 0-4.5zM2.5 8c1.5-1.2 3.2-1.2 4.5 0-1.3 1.2-3 1.2-4.5 0zm6.5 0c1.5-1.2 3.2-1.2 4.5 0-1.3 1.2-3 1.2-4.5 0z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  smoke: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12h8M5 10c1-2 2-3 3-3s2 1 3 3M6.5 7c.5-1.5 1.2-2.5 1.5-2.5S9.5 5.5 10 7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  gym: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h2v2H2zm10 0h2v2h-2zM5 8.5h6v1H5zM3.5 6.5v5M12.5 6.5v5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  atm: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v10H3zm2 2h6v3H5zm1 5h2v1H6zm3 0h2v1H9z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  gate: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13V4l6-2 6 2v9M5 13V7m3 6V6.5m3 6.5V7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  pod: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12V6l5-3 5 3v6H3zm2-1h6V7.2L8 5.5 5 7.2V11z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  print: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v3H4zm-1 4h10v5H3zm2 2h2v1H5zm6-5v8H5V3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
const boxW = (b: Box) => { const [x0, z0] = toWorld(b), [x1, z1] = toWorld({ x: b.x + b.w, y: b.y + b.h }); return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 }; };
function sign(ctx: TownCtx, html: string, text: string, sub: string, mau: string, x: number, y: number, z: number, testid: string, labelKey?: LabelKey) {
  const div = document.createElement('div'); div.className = 'nhan-phong-3d nhan-pho'; div.style.setProperty('--mau', mau); div.dataset.testid = testid;
  if (labelKey) div.dataset.label = labelKey;
  div.innerHTML = html; div.append(document.createTextNode(text));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; div.append(s); }
  if (labelKey && labelKey !== 'monitor') applyLabelVisibility(div, isLabelOn(labelKey));
  const o = new CSS2DObject(div); o.center.set(0.5, 1); o.position.set(x, y, z); ctx.nhom.add(o); return div;
}

// ---------- static scenery ----------
function ground(ctx: TownCtx) {
  const { x0, x1, z0, z1 } = CANH, n = ctx.nhom;
  khoi(n, x1 - x0 + 2, 0.2, z1 - z0 + 2, '#9ccc7e', (x0 + x1) / 2, -0.12, (z0 + z1) / 2, false);
  for (const r of ROADS) {
    const b = boxW(r), h = r.w > r.h;
    khoi(n, b.w + (h ? 0 : 0.6), 0.06, b.d + (h ? 0.6 : 0), '#cfc8ba', b.cx, -0.03, b.cz, false); // sidewalk
    khoi(n, b.w, 0.06, b.d, '#4b505c', b.cx, -0.0, b.cz, false);
    const len = h ? b.w : b.d;
    for (let s = 0.6; s < len - 0.6; s += 1.6) khoi(n, h ? 0.8 : 0.08, 0.01, h ? 0.08 : 0.8, '#f3ecd2', h ? b.x0 + s : b.cx, 0.035, h ? b.cz : b.z0 + s, false);
  }
  // zebra crossing in front of the office
  const f = boxW(ROADS[1]); for (let i = 0; i < 6; i++) khoi(n, 0.32, 0.01, f.d - 0.3, '#f3ecd2', -1 + i * 0.42, 0.04, f.cz, false);
  // trees along the streets
  for (const [x, z] of [[-19.5, -8], [-12, 12.5], [0, 12.6], [9, 12.5], [16.5, 12.3], [21, 6]]) tree(n, x, z); // dropped [-19.5,9] + [-14.2,12.5] for Bia Hải Xồm across from gate
}
function tree(cha: THREE.Object3D, x: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, 0, z); cha.add(g);
  khoi(g, 0.26, 1.2, 0.26, '#8a5a3b', 0, 0.6, 0);
  khoi(g, 1.3, 0.9, 1.3, '#4caf6a', 0, 1.55, 0); khoi(g, 0.95, 0.7, 0.95, '#5cc27a', 0.1, 2.25, -0.05).rotation.y = 0.5; khoi(g, 0.5, 0.45, 0.5, '#6fd08b', -0.05, 2.75, 0.05);
}
function cafe(ctx: TownCtx) {
  const b = boxW(CAFE), n = ctx.nhom, g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); n.add(g);
  const W = b.w, D = b.d, H = 2.5, go = '#6b4a34';
  khoi(g, W, 0.08, D, '#d9c4a5', 0, 0.04, 0, false);
  for (let i = 0; i < 7; i++) khoi(g, W, 0.004, 0.02, '#c4ab88', 0, 0.082, -D / 2 + (i + 0.5) * D / 7, false);
  khoi(g, W, H, 0.18, go, 0, H / 2, -D / 2 + 0.09); // back wall
  for (const s of [-1, 1]) khoi(g, 0.18, H, D, go, s * (W / 2 - 0.09), H / 2, 0);
  khoi(g, W + 0.3, 0.14, D + 0.3, '#4a3224', 0, H + 0.07, 0, false); // roof edge
  // striped awning over the open front
  const N = 8; for (let i = 0; i < N; i++) { const a = khoi(g, W / N, 0.06, 1.1, i % 2 ? '#2f7d6d' : '#efe7d4', -W / 2 + (i + 0.5) * W / N, H - 0.25, D / 2 + 0.35); a.rotation.x = 0.35; }
  // counter + espresso machine + menu board
  khoi(g, W - 1.2, 0.95, 0.6, '#a5774f', 0, 0.48, -D / 2 + 1); khoi(g, W - 1.1, 0.06, 0.7, '#3d2c22', 0, 0.98, -D / 2 + 1);
  khoi(g, 0.5, 0.5, 0.4, '#2b2a30', -0.8, 1.26, -D / 2 + 0.95); khoi(g, 0.06, 0.06, 0.06, vatLieuSang('#3bff7a'), -0.65, 1.4, -D / 2 + 1.16, false);
  for (let i = 0; i < 4; i++) khoi(g, 0.12, 0.14, 0.12, ['#ffffff', '#f5efe6', '#ffffff', '#e9925f'][i], 0.2 + i * 0.25, 1.08, -D / 2 + 1);
  khoi(g, 1.8, 0.9, 0.04, '#1f1712', 0.6, 1.9, -D / 2 + 0.2, false);
  for (let i = 0; i < 3; i++) khoi(g, 1.3 - i * 0.2, 0.05, 0.01, '#f6d7a7', 0.5, 2.15 - i * 0.22, -D / 2 + 0.225, false);
  // tables and stools
  for (const [x, z] of [[-1.4, 0.6], [0.2, 1.4], [1.6, 0.4], [-0.6, 2.4]]) {
    const t = new THREE.Group(); t.position.set(x, 0, z); g.add(t);
    khoi(t, 0.06, 0.7, 0.06, '#3d2c22', 0, 0.35, 0); khoi(t, 0.7, 0.05, 0.7, '#d9b98f', 0, 0.72, 0); khoi(t, 0.12, 0.1, 0.12, '#ffffff', 0.12, 0.8, 0.05);
    for (const [dx, dz] of [[-0.6, 0], [0.6, 0]]) { khoi(t, 0.36, 0.06, 0.36, '#2f7d6d', dx, 0.45, dz); khoi(t, 0.05, 0.42, 0.05, '#3d2c22', dx, 0.21, dz); }
  }
  ctx.plant(g, -W / 2 + 0.5, D / 2 - 0.4, 0.9); ctx.plant(g, W / 2 - 0.5, D / 2 - 0.4, 0.9);
  const chao = ctx.own(new THREE.MeshLambertMaterial({ color: '#fff4d6', emissive: '#ffd27a', emissiveIntensity: 0 }));
  for (const x of [-1, 1]) khoi(g, 0.3, 0.2, 0.3, chao, x, H - 0.25, 0, false); ctx.shades.push(chao);
  if (!ctx.soft) { const l = new THREE.PointLight('#ffd9a0', 0, 9, 1.6); l.position.set(0, H - 0.4, 0.5); g.add(l); ctx.lights.push(l); }
  sign(ctx, ICON.coffee, 'Crossian Cafe', 'cà phê · bạc xỉu', '#2f7d6d', b.cx, H + 0.6, b.cz - D / 2 + 0.2, 'vp-cafe', 'cafe');
}
/** Xuka Mát xa: across the back street from Crossian Cafe, open front facing the street. Beds + towels + lanterns, PG. */
function massage(ctx: TownCtx) {
  const b = boxW(MASSAGE), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  const W = b.w, D = b.d, H = 2.6, tuong = '#f3d9e4', vien = '#b0476f';
  khoi(g, W, 0.08, D, '#e9dcc7', 0, 0.04, 0, false);
  for (let i = 0; i < 6; i++) khoi(g, W, 0.004, 0.02, '#d6c4a8', 0, 0.082, -D / 2 + (i + 0.5) * D / 6, false);
  khoi(g, W, H, 0.18, tuong, 0, H / 2, -D / 2 + 0.09);
  for (const s of [-1, 1]) khoi(g, 0.18, H, D, tuong, s * (W / 2 - 0.09), H / 2, 0);
  khoi(g, W + 0.3, 0.14, D + 0.3, vien, 0, H + 0.07, 0, false);
  const N = 8; for (let i = 0; i < N; i++) { const a = khoi(g, W / N, 0.06, 1.1, i % 2 ? vien : '#fbe7ef', -W / 2 + (i + 0.5) * W / N, H - 0.25, D / 2 + 0.35); a.rotation.x = 0.35; }
  // massage beds with towels and pillows, curtains between them
  for (const p of MASSAGE_BEDS) {
    const [x, z] = toWorld(p), lx = x - b.cx, lz = z - b.cz;
    khoi(g, 0.8, 0.5, 1.9, '#8d5a3b', lx, 0.3, lz); khoi(g, 0.82, 0.1, 1.92, '#ffffff', lx, 0.6, lz); khoi(g, 0.5, 0.1, 0.3, '#f8bbd0', lx, 0.7, lz - 0.7, false);
    khoi(g, 0.84, 0.04, 0.5, '#b0476f', lx, 0.66, lz + 0.4, false);
  }
  for (const s of [-1, 1]) khoi(g, 0.04, 1.8, 1.8, vatLieu('#f8bbd0', { transparent: true, opacity: 0.55 }), s * 0.9, 1, -0.3, false);
  // reception, towel shelf, aroma candles, lotus pots
  khoi(g, 1.4, 0.9, 0.5, '#8d5a3b', -W / 2 + 1.1, 0.45, D / 2 - 0.9); khoi(g, 1.5, 0.06, 0.6, '#5d3a26', -W / 2 + 1.1, 0.93, D / 2 - 0.9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) khoi(g, 0.3, 0.14, 0.3, ['#ffffff', '#f8bbd0', '#b2dfdb'][j], W / 2 - 0.5, 0.4 + i * 0.4 + j * 0.13, -D / 2 + 0.6 + j * 0.02, false);
  for (const x of [-0.6, 0.6]) { khoi(g, 0.08, 0.14, 0.08, '#fff3e0', x, 1.0, D / 2 - 0.9, false); khoi(g, 0.04, 0.06, 0.04, vatLieuSang('#ffb74d'), x, 1.1, D / 2 - 0.9, false); }
  ctx.plant(g, -W / 2 + 0.4, D / 2 - 0.3, 0.8); ctx.plant(g, W / 2 - 0.4, D / 2 - 0.3, 0.8);
  const chao = ctx.own(new THREE.MeshLambertMaterial({ color: '#ffd6e6', emissive: '#ff8fb8', emissiveIntensity: 0 }));
  for (const x of [-1.2, 0, 1.2]) khoi(g, 0.26, 0.34, 0.26, chao, x, H - 0.3, 0.6, false); ctx.shades.push(chao);
  if (!ctx.soft) { const l = new THREE.PointLight('#ffc2da', 0, 9, 1.6); l.position.set(0, H - 0.4, 0.5); g.add(l); ctx.lights.push(l); }
  sign(ctx, ICON.spa, 'Xuka Mát xa', 'cổ vai gáy · ngâm chân', '#b0476f', b.cx, H + 0.6, b.cz + D / 2 - 0.2, 'vp-massage', 'massage');
}
/** Xém Nướng: BBQ + crocodile-meat hotpot opposite the pond. Voxel like Crossian / Xuka. */
function xemNuong(ctx: TownCtx) {
  const b = boxW(BBQ), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  const W = b.w, D = b.d, H = 2.55, go = '#6b3a2a', accent = '#c45c26';
  khoi(g, W, 0.08, D, '#c4a882', 0, 0.04, 0, false);
  for (let i = 0; i < 6; i++) khoi(g, W, 0.004, 0.02, '#a88860', 0, 0.082, -D / 2 + (i + 0.5) * D / 6, false);
  khoi(g, W, H, 0.18, go, 0, H / 2, -D / 2 + 0.09);
  for (const s of [-1, 1]) khoi(g, 0.18, H, D, go, s * (W / 2 - 0.09), H / 2, 0);
  khoi(g, W + 0.3, 0.14, D + 0.3, '#3d2418', 0, H + 0.07, 0, false);
  const N = 8; for (let i = 0; i < N; i++) { const a = khoi(g, W / N, 0.06, 1.1, i % 2 ? accent : '#f3e0c8', -W / 2 + (i + 0.5) * W / N, H - 0.25, D / 2 + 0.35); a.rotation.x = 0.35; }
  // grill + hotpot table
  khoi(g, 1.6, 0.7, 0.7, '#3a3a44', -0.9, 0.4, -D / 2 + 1.1); khoi(g, 1.5, 0.08, 0.6, '#1f1f24', -0.9, 0.78, -D / 2 + 1.1);
  for (let i = 0; i < 5; i++) khoi(g, 1.35, 0.02, 0.04, '#8a8f99', -0.9, 0.84, -D / 2 + 0.9 + i * 0.08, false);
  khoi(g, 0.55, 0.2, 0.55, vatLieuSang('#ff6a2a'), -0.9, 0.95, -D / 2 + 1.1, false);
  khoi(g, 1.1, 0.55, 1.1, '#5d4037', 1.0, 0.35, -0.2); khoi(g, 0.7, 0.25, 0.7, '#b71c1c', 1.0, 0.75, -0.2);
  khoi(g, 0.55, 0.18, 0.55, vatLieu('#ef5350', { transparent: true, opacity: 0.7 }), 1.0, 0.95, -0.2, false);
  // tables + stools at BBQ_SEATS
  for (const p of BBQ_SEATS) {
    const [x, z] = toWorld(p), lx = x - b.cx, lz = z - b.cz;
    khoi(g, 0.7, 0.05, 0.7, '#8d6e4c', lx, 0.72, lz); khoi(g, 0.06, 0.7, 0.06, '#4e342e', lx, 0.35, lz);
    khoi(g, 0.14, 0.1, 0.14, '#ffffff', lx + 0.15, 0.8, lz + 0.1);
    for (const [dx, dz] of [[-0.55, 0.1], [0.55, 0.1]]) { khoi(g, 0.34, 0.06, 0.34, accent, lx + dx, 0.45, lz + dz); khoi(g, 0.05, 0.42, 0.05, '#4e342e', lx + dx, 0.21, lz + dz); }
  }
  // croc-themed menu board + smoke lanterns
  khoi(g, 1.6, 0.9, 0.04, '#2b1a12', 0.2, 1.85, -D / 2 + 0.2, false);
  for (let i = 0; i < 3; i++) khoi(g, 1.1 - i * 0.15, 0.05, 0.01, '#f6d7a7', 0.15, 2.1 - i * 0.2, -D / 2 + 0.225, false);
  ctx.plant(g, -W / 2 + 0.45, D / 2 - 0.35, 0.85); ctx.plant(g, W / 2 - 0.45, D / 2 - 0.35, 0.85);
  const chao = ctx.own(new THREE.MeshLambertMaterial({ color: '#ffd4a8', emissive: '#ff8a3d', emissiveIntensity: 0 }));
  for (const x of [-1.1, 0.2, 1.3]) khoi(g, 0.28, 0.28, 0.28, chao, x, H - 0.3, 0.4, false); ctx.shades.push(chao);
  if (!ctx.soft) { const l = new THREE.PointLight('#ffb070', 0, 9, 1.6); l.position.set(0, H - 0.4, 0.4); g.add(l); ctx.lights.push(l); }
  sign(ctx, ICON.grill, 'Xém Nướng', 'BBQ · lẩu cá sấu', accent, b.cx, H + 0.6, b.cz + D / 2 - 0.2, 'vp-xem-nuong', 'bbq');
}
/** Flower garden between Xuka and Xém Nướng — secret-affair hangout. */
function garden(ctx: TownCtx) {
  const b = boxW(GARDEN), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.06, b.d, '#7cbc5a', 0, 0.02, 0, false);
  // gravel path through the middle
  khoi(g, b.w * 0.9, 0.04, 0.7, '#d5c4a1', 0, 0.04, 0, false);
  const petals = ['#f48fb1', '#ce93d8', '#fff59d', '#ef9a9a', '#80cbc4', '#ffcc80'];
  for (let i = 0; i < 28; i++) {
    const lx = -b.w / 2 + 0.6 + (i % 14) * (b.w - 1.2) / 13, lz = (i < 14 ? -1 : 1) * (0.7 + (i % 5) * 0.22);
    khoi(g, 0.08, 0.35, 0.08, '#2e7d32', lx, 0.2, lz);
    khoi(g, 0.28, 0.1, 0.28, petals[i % petals.length], lx, 0.42, lz, false);
    khoi(g, 0.1, 0.1, 0.1, '#ffe082', lx, 0.5, lz, false);
  }
  // benches at romance spots
  for (const p of ROMANCE_SPOTS) {
    const [x, z] = toWorld(p), lx = x - b.cx, lz = z - b.cz;
    khoi(g, 1.1, 0.08, 0.4, '#8d6e4c', lx, 0.42, lz + 0.35); khoi(g, 1.1, 0.45, 0.08, '#6d4c35', lx, 0.55, lz + 0.55);
    for (const s of [-1, 1]) khoi(g, 0.08, 0.4, 0.08, '#5d4037', lx + s * 0.45, 0.2, lz + 0.35);
  }
  // low hedges at the edges
  for (const s of [-1, 1]) khoi(g, b.w - 0.4, 0.45, 0.22, '#4caf50', 0, 0.25, s * (b.d / 2 - 0.2));
  sign(ctx, ICON.flower, 'Vườn hoa', 'đi bộ · hẹn hò…?', '#ad1457', b.cx, 1.6, b.cz - b.d / 2 + 0.3, 'vp-garden', 'garden');
}
function trada(ctx: TownCtx) {
  const b = boxW(TRADA), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.03, b.d, '#bdb6a8', 0, 0.015, 0, false);
  // low blue plastic table, red/blue stools
  khoi(g, 1.8, 0.05, 0.8, '#2f6fe0', 0, 0.42, 0.15); for (const [x, z] of [[-0.8, -0.2], [0.8, -0.2], [-0.8, 0.5], [0.8, 0.5]]) khoi(g, 0.05, 0.4, 0.05, '#2457b8', x, 0.2, z);
  const cup = vatLieu('#f4e9b8', { transparent: true, opacity: 0.8 });
  for (let i = 0; i < 4; i++) khoi(g, 0.1, 0.16, 0.1, cup, -0.6 + i * 0.4, 0.53, 0.1 + (i % 2) * 0.15);
  for (let i = 0; i < 4; i++) { const x = -1.3 + i * 0.85, z = 1.05 + (i % 2) * 0.08, c = i % 2 ? '#2563eb' : '#e23d3d'; khoi(g, 0.36, 0.05, 0.36, c, x, 0.3, z); for (const s of [-1, 1]) khoi(g, 0.04, 0.28, 0.32, c, x + s * 0.15, 0.14, z); }
  // cart with the big tea jug, beer crate, umbrella
  khoi(g, 0.9, 0.6, 0.6, '#c9a46a', -1.6, 0.4, -0.9); for (const s of [-1, 1]) khoi(g, 0.08, 0.3, 0.3, '#3a3a44', -1.6 + s * 0.4, 0.15, -0.9);
  khoi(g, 0.42, 0.5, 0.42, '#f2c14e', -1.65, 0.95, -0.9); khoi(g, 0.46, 0.06, 0.46, '#d89a2b', -1.65, 1.22, -0.9); khoi(g, 0.08, 0.06, 0.08, '#e23d3d', -1.4, 0.82, -0.68, false);
  khoi(g, 0.6, 0.35, 0.42, '#2e7d32', 1.7, 0.18, -0.7); for (let i = 0; i < 6; i++) khoi(g, 0.07, 0.18, 0.07, '#8bc34a', 1.5 + (i % 3) * 0.2, 0.44, -0.8 + Math.floor(i / 3) * 0.2, false);
  khoi(g, 0.06, 2.3, 0.06, '#5d5f6b', 0.1, 1.15, -0.3);
  for (let i = 0; i < 4; i++) khoi(g, 0.6, 0.06, 2.4, i % 2 ? '#f5d547' : '#e23d3d', -0.8 + i * 0.6, 2.32, -0.2, false);
  sign(ctx, ICON.glass, 'Trà đá vỉa hè', '3 nghìn một cốc', '#d89a2b', b.cx, 2.75, b.cz, 'vp-trada', 'trada');
}
export interface Croc { g: THREE.Group; ham: THREE.Group; a: number; r: number; v: number }
function crocMesh(cha: THREE.Object3D): Croc {
  const g = new THREE.Group(); cha.add(g); const xanh = '#3f7d3a', dam = '#2f6a2c';
  khoi(g, 0.5, 0.22, 1.5, xanh, 0, 0.11, 0); khoi(g, 0.34, 0.16, 0.7, dam, 0, 0.08, -1.05); khoi(g, 0.2, 0.12, 0.5, dam, 0, 0.06, -1.6);
  for (let i = 0; i < 4; i++) khoi(g, 0.1, 0.08, 0.1, dam, 0, 0.26, -0.5 + i * 0.32, false);
  for (const s of [-1, 1]) for (const z of [-0.45, 0.45]) khoi(g, 0.14, 0.1, 0.2, dam, s * 0.32, 0.03, z, false);
  khoi(g, 0.4, 0.1, 0.62, xanh, 0, 0.06, 1.04); // lower jaw
  const ham = new THREE.Group(); ham.position.set(0, 0.16, 0.74); g.add(ham); // upper jaw, hinged at the back
  khoi(ham, 0.42, 0.12, 0.66, xanh, 0, 0.02, 0.32); for (const s of [-1, 1]) { khoi(ham, 0.1, 0.1, 0.1, '#f2e36b', s * 0.13, 0.12, 0.02, false); khoi(ham, 0.04, 0.06, 0.04, '#1d1a22', s * 0.13, 0.14, 0.07, false); }
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) khoi(ham, 0.04, 0.06, 0.04, '#ffffff', s * 0.17, -0.06, 0.12 + i * 0.14, false);
  return { g, ham, a: 0, r: 0.6, v: 0.3 };
}
function pond(ctx: TownCtx) {
  const [cx, cz] = toWorld(pondCenter()), rx = POND.rx / PX, rz = POND.ry / PX;
  const cyl = ctx.own(new THREE.CylinderGeometry(1, 1, 1, 40));
  const vien = new THREE.Mesh(cyl, vatLieu('#9b8a6b')); vien.scale.set(rx + 0.45, 0.16, rz + 0.45); vien.position.set(cx, 0.06, cz); ctx.nhom.add(vien);
  const nuoc = new THREE.Mesh(cyl, vatLieu('#3f95b3', { emissive: '#1d5f78', emissiveIntensity: 0.25 })); nuoc.scale.set(rx, 0.05, rz); nuoc.position.set(cx, 0.15, cz); nuoc.receiveShadow = !ctx.soft; ctx.nhom.add(nuoc);
  for (let i = 0; i < 10; i++) { const a = i * 0.63 + 0.3, x = cx + Math.cos(a) * (rx + 0.25), z = cz + Math.sin(a) * (rz + 0.25); khoi(ctx.nhom, 0.08, 0.5 + (i % 3) * 0.2, 0.08, '#4f8f3a', x, 0.35, z, false); }
  for (const [dx, dz] of [[-0.6, 1.6], [0.5, -2.2]]) khoi(ctx.nhom, 0.6, 0.02, 0.5, '#5fae4f', cx + dx, 0.18, cz + dz, false); // lily pads
  // warning sign
  khoi(ctx.nhom, 0.08, 1.2, 0.08, '#6b5544', cx + rx + 0.7, 0.6, cz - rz * 0.6); khoi(ctx.nhom, 0.7, 0.45, 0.05, '#f5d547', cx + rx + 0.7, 1.25, cz - rz * 0.6);
  sign(ctx, ICON.croc, 'Hồ cá sấu', 'cấm cho ăn', '#3f7d3a', cx, 1.4, cz - rz - 0.3, 'vp-pond', 'pond');
  const crocs = [0, 1, 2].map((i) => { const c = crocMesh(ctx.nhom); c.a = i * 2.1; c.r = 0.45 + i * 0.12; c.v = 0.25 + i * 0.07; return c; });
  const splash = new THREE.Mesh(ctx.own(new THREE.RingGeometry(0.7, 0.9, 32)), ctx.own(new THREE.MeshBasicMaterial({ color: '#e8f8ff', transparent: true, side: THREE.DoubleSide })));
  splash.rotation.x = -Math.PI / 2; splash.position.set(cx, 0.2, cz); splash.visible = false; ctx.nhom.add(splash);
  return { cx, cz, rx, rz, crocs, splash };
}
/** Small indoor status panel next to IT Ops (no outdoor street kiosk). */
function noc(ctx: TownCtx) {
  const [x, z] = toWorld(ITOPS_SPOT), g = new THREE.Group(); g.position.set(x + 0.85, 0, z - 0.1); g.rotation.y = 0.3; ctx.nhom.add(g);
  khoi(g, 1.1, 0.7, 0.5, '#5d5f6b', 0, 0.35, 0); khoi(g, 1.15, 0.05, 0.55, '#3a3a44', 0, 0.72, 0);
  const man = ctx.own(new THREE.MeshLambertMaterial({ color: '#1c2030', emissive: '#94a3b8', emissiveIntensity: 0.4 }));
  khoi(g, 0.9, 0.5, 0.04, '#2a2833', 0, 1.05, -0.1); khoi(g, 0.82, 0.42, 0.01, man, 0, 1.05, -0.07, false);
  khoi(g, 0.12, 1.1, 0.12, '#3a3a44', 0.55, 0.55, -0.15); const den = ctx.own(new THREE.MeshLambertMaterial({ color: '#94a3b8', emissive: '#94a3b8', emissiveIntensity: 0.3 })); khoi(g, 0.2, 0.2, 0.2, den, 0.55, 1.2, -0.15);
  const el = sign(ctx, ICON.pulse, 'Monitor', '', '#64748b', x + 0.85, 2.05, z - 0.1, 'noc', 'monitor');
  const b = document.createElement('b'); el.append(document.createTextNode(': '), b);
  return { man, den, el, b };
}


/** Smoking / cooler corner west of the pond. */
function smokeCorner(ctx: TownCtx) {
  const b = boxW(SMOKE), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.04, b.d, '#8a9a7a', 0, 0.02, 0, false);
  // cooler
  khoi(g, 0.42, 1.0, 0.42, '#e8edf2', -1.2, 0.5, -0.2); khoi(g, 0.34, 0.4, 0.34, vatLieu('#8fc9ff', { transparent: true, opacity: 0.7 }), -1.2, 1.2, -0.2, false);
  for (const [dz, c] of [[-0.08, '#3b82f6'], [0.08, '#ef4444']] as const) khoi(g, 0.05, 0.05, 0.05, c, -1.0, 0.8, dz, false);
  // ashtray stand + benches
  khoi(g, 0.12, 0.9, 0.12, '#5d5f6b', 0.4, 0.45, 0.3); khoi(g, 0.28, 0.06, 0.28, '#3a3a44', 0.4, 0.92, 0.3);
  for (const lx of [-0.3, 1.1]) { khoi(g, 1.0, 0.08, 0.36, '#6d4c35', lx, 0.4, 0.9); for (const s of [-1, 1]) khoi(g, 0.06, 0.38, 0.06, '#4e342e', lx + s * 0.4, 0.19, 0.9); }
  // cigarette butt tray hint
  khoi(g, 0.2, 0.04, 0.2, '#c4cad3', 0.4, 0.96, 0.3, false);
  ctx.plant(g, b.w / 2 - 0.3, -b.d / 2 + 0.3, 0.7);
  sign(ctx, ICON.smoke, 'Góc hút thuốc', 'cooler · tin đồn', '#64748b', b.cx, 1.8, b.cz, 'vp-smoke', 'smoke');
}
/** Outdoor gym + table tennis in the south yard. */
function gymYard(ctx: TownCtx) {
  const b = boxW(GYM), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.05, b.d, '#c4b89a', 0, 0.02, 0, false);
  // table tennis
  khoi(g, 2.4, 0.06, 1.3, '#1e88e5', -2.2, 0.76, 0); khoi(g, 0.06, 0.72, 0.06, '#5d5f6b', -3.2, 0.36, -0.5); khoi(g, 0.06, 0.72, 0.06, '#5d5f6b', -1.2, 0.36, -0.5);
  khoi(g, 0.06, 0.72, 0.06, '#5d5f6b', -3.2, 0.36, 0.5); khoi(g, 0.06, 0.72, 0.06, '#5d5f6b', -1.2, 0.36, 0.5);
  khoi(g, 0.04, 0.28, 1.28, '#ffffff', -2.2, 0.92, 0, false);
  // rack of dumbbells
  khoi(g, 1.4, 0.5, 0.4, '#3a3a44', 1.8, 0.25, -0.6);
  for (let i = 0; i < 4; i++) { khoi(g, 0.08, 0.08, 0.55, '#8a8f99', 1.3 + i * 0.3, 0.55, -0.6); khoi(g, 0.16, 0.16, 0.16, '#2a2a30', 1.3 + i * 0.3, 0.55, -0.85); khoi(g, 0.16, 0.16, 0.16, '#2a2a30', 1.3 + i * 0.3, 0.55, -0.35); }
  // mat
  khoi(g, 1.6, 0.03, 1.0, '#ef5350', 2.0, 0.04, 0.8, false);
  sign(ctx, ICON.gym, 'Gym ngoài trời', 'bóng bàn · tạ', '#1565c0', b.cx, 1.7, b.cz - b.d / 2 + 0.2, 'vp-gym', 'gym');
}
/** ATM + snack machine near trà đá. */
function atmSnack(ctx: TownCtx) {
  const b = boxW(ATM), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.03, b.d, '#b0b8c0', 0, 0.015, 0, false);
  // ATM
  khoi(g, 0.7, 1.5, 0.45, '#2a2f3a', -0.9, 0.75, -0.2); khoi(g, 0.5, 0.35, 0.04, vatLieuSang('#4fc3f7'), -0.9, 1.15, 0.04, false);
  khoi(g, 0.35, 0.08, 0.08, '#1a1f28', -0.9, 0.7, 0.05, false); khoi(g, 0.2, 0.05, 0.05, '#66bb6a', -0.9, 0.55, 0.05, false);
  // snack machine
  khoi(g, 0.85, 1.7, 0.55, '#e53935', 0.7, 0.85, -0.15); khoi(g, 0.7, 1.2, 0.04, vatLieu('#81d4fa', { transparent: true, opacity: 0.55 }), 0.7, 0.95, 0.14, false);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) khoi(g, 0.14, 0.14, 0.1, ['#ffeb3b', '#8bc34a', '#ff9800', '#e91e63', '#fff', '#2196f3'][(r * 3 + c) % 6], 0.4 + c * 0.22, 1.35 - r * 0.3, 0.1, false);
  khoi(g, 0.35, 0.08, 0.12, '#1a1a1a', 0.7, 0.25, 0.15, false);
  sign(ctx, ICON.atm, 'ATM · Snack', 'rút tiền · mì tôm', '#c62828', b.cx, 2.1, b.cz, 'vp-atm', 'atm');
}
/** Parking / security gate SW. */
function securityGate(ctx: TownCtx) {
  const b = boxW(GATE), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.03, b.d, '#9e9e9e', 0, 0.015, 0, false);
  // booth
  khoi(g, 1.2, 2.0, 1.2, '#eceff1', -1.3, 1.0, 0); khoi(g, 1.3, 0.1, 1.3, '#37474f', -1.3, 2.05, 0, false);
  khoi(g, 0.7, 0.5, 0.05, vatLieu('#81d4fa', { transparent: true, opacity: 0.5 }), -1.3, 1.3, 0.6, false);
  khoi(g, 0.3, 0.08, 0.08, '#fdd835', -1.3, 1.7, 0.62, false);
  // barrier arm
  khoi(g, 0.15, 0.9, 0.15, '#455a64', 0.2, 0.45, 0); khoi(g, 2.4, 0.1, 0.12, '#fdd835', 1.4, 0.95, 0); khoi(g, 2.4, 0.1, 0.04, '#212121', 1.4, 0.95, 0.02, false);
  // parking lines
  for (let i = 0; i < 3; i++) khoi(g, 0.08, 0.02, 1.0, '#ffffff', 0.6 + i * 0.9, 0.03, 0.3, false);
  sign(ctx, ICON.gate, 'Cổng bảo vệ', 'đỗ xe · xin vào', '#455a64', b.cx, 2.4, b.cz, 'vp-gate', 'gate');
}
/** Glass outdoor meeting pod — fake meetings / naps. */
function meetingPod(ctx: TownCtx) {
  const b = boxW(POD), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  const glass = vatLieu('#b3e5fc', { transparent: true, opacity: 0.35 });
  khoi(g, b.w, 0.06, b.d, '#cfd8dc', 0, 0.03, 0, false);
  // glass walls
  khoi(g, b.w, 2.2, 0.08, glass, 0, 1.1, -b.d / 2 + 0.04, false);
  khoi(g, b.w, 2.2, 0.08, glass, 0, 1.1, b.d / 2 - 0.04, false);
  for (const s of [-1, 1]) khoi(g, 0.08, 2.2, b.d, glass, s * (b.w / 2 - 0.04), 1.1, 0, false);
  khoi(g, b.w + 0.2, 0.1, b.d + 0.2, '#90a4ae', 0, 2.25, 0, false);
  // table + chairs
  khoi(g, 1.4, 0.06, 0.8, '#eceff1', 0, 0.72, 0); khoi(g, 0.08, 0.7, 0.08, '#78909c', 0, 0.35, 0);
  for (const [dx, dz] of [[-0.7, 0.55], [0.7, 0.55], [-0.7, -0.55], [0.7, -0.55]]) {
    khoi(g, 0.4, 0.06, 0.4, '#42a5f5', dx, 0.45, dz); khoi(g, 0.05, 0.42, 0.05, '#546e7a', dx, 0.21, dz);
  }
  // laptop decoy
  khoi(g, 0.35, 0.02, 0.25, '#263238', 0.15, 0.78, 0.1, false); khoi(g, 0.35, 0.22, 0.02, vatLieuSang('#4fc3f7'), 0.15, 0.9, -0.02, false);
  sign(ctx, ICON.pod, 'Pod họp ngoài', 'meeting giả · ngủ', '#0288d1', b.cx, 2.6, b.cz, 'vp-pod', 'pod');
}

/** Bia Hải Xồm — beer stall opposite parking/gate across the front street. */
function biaHaiXom(ctx: TownCtx) {
  const b = boxW(BIA), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  const accent = '#c62828';
  khoi(g, b.w, 0.06, b.d, '#d7ccc8', 0, 0.03, 0, false);
  // open stall counter + roof
  khoi(g, b.w * 0.9, 1.1, 0.18, '#efebe9', 0, 0.7, -b.d / 2 + 0.2);
  khoi(g, b.w * 0.95, 0.08, b.d * 0.7, accent, 0, 2.05, 0, false);
  khoi(g, 0.08, 2.0, 0.08, '#5d4037', -b.w / 2 + 0.2, 1.0, -b.d / 2 + 0.25);
  khoi(g, 0.08, 2.0, 0.08, '#5d4037', b.w / 2 - 0.2, 1.0, -b.d / 2 + 0.25);
  khoi(g, 0.08, 2.0, 0.08, '#5d4037', -b.w / 2 + 0.2, 1.0, b.d / 2 - 0.3);
  khoi(g, 0.08, 2.0, 0.08, '#5d4037', b.w / 2 - 0.2, 1.0, b.d / 2 - 0.3);
  // beer taps / kegs
  khoi(g, 0.55, 0.9, 0.55, '#90a4ae', -1.3, 0.5, -0.5); khoi(g, 0.55, 0.9, 0.55, '#78909c', -0.5, 0.5, -0.5);
  khoi(g, 0.08, 0.35, 0.08, '#eceff1', -1.3, 1.05, -0.2); khoi(g, 0.08, 0.35, 0.08, '#eceff1', -0.5, 1.05, -0.2);
  // plastic stools + low tables at seats
  for (const p of BIA_SEATS) {
    const [x, z] = toWorld(p), lx = x - b.cx, lz = z - b.cz;
    khoi(g, 0.55, 0.06, 0.55, '#fff59d', lx, 0.42, lz);
    khoi(g, 0.08, 0.4, 0.08, '#f9a825', lx, 0.2, lz);
    khoi(g, 0.32, 0.05, 0.32, ['#42a5f5', '#66bb6a', '#ef5350', '#ab47bc', '#29b6f6'][Math.abs(Math.round(lx * 3 + lz)) % 5], lx + 0.55, 0.38, lz + 0.15);
    khoi(g, 0.05, 0.36, 0.05, '#546e7a', lx + 0.55, 0.18, lz + 0.15);
  }
  // signboard
  khoi(g, 1.8, 0.45, 0.06, accent, 0, 2.35, -b.d / 2 + 0.15, false);
  sign(ctx, ICON.glass, 'Bia Hải Xồm', 'bia hơi · lạc rang', accent, b.cx, 2.9, b.cz - b.d / 2 + 0.2, 'vp-bia', 'bia');
}

/** Photocopy / printer kiosk on the front sidewalk. */
function printKiosk(ctx: TownCtx) {
  const b = boxW(PRINT), g = new THREE.Group(); g.position.set(b.cx, 0, b.cz); ctx.nhom.add(g);
  khoi(g, b.w, 0.03, b.d, '#bdbdbd', 0, 0.015, 0, false);
  // printer
  khoi(g, 1.1, 0.85, 0.7, '#eceff1', -0.6, 0.45, 0); khoi(g, 0.9, 0.08, 0.5, '#90a4ae', -0.6, 0.92, 0);
  khoi(g, 0.5, 0.05, 0.35, '#ffffff', -0.6, 0.98, 0.05, false); // paper out
  khoi(g, 0.2, 0.08, 0.08, '#66bb6a', -0.2, 0.7, 0.36, false);
  // photocopy stand
  khoi(g, 0.9, 1.1, 0.65, '#78909c', 1.0, 0.55, 0); khoi(g, 0.7, 0.5, 0.04, vatLieu('#81d4fa', { transparent: true, opacity: 0.45 }), 1.0, 0.9, 0.34, false);
  khoi(g, 0.5, 0.02, 0.4, '#fafafa', 1.0, 1.12, 0.05, false);
  // paper stack mess
  for (let i = 0; i < 3; i++) khoi(g, 0.35, 0.02, 0.28, '#fff', -0.1 + i * 0.05, 0.2 + i * 0.03, 0.5, false);
  sign(ctx, ICON.print, 'Máy in · photocopy', 'kẹt giấy · lương sếp?', '#546e7a', b.cx, 1.9, b.cz, 'vp-print', 'print');
}

// ---------- side characters ----------
interface Pet { goc: THREE.Group; dau: THREE.Group; duoi: THREE.Group; chan: THREE.Group[] }
function petMesh(meo: boolean): Pet {
  const goc = new THREE.Group(), long = meo ? '#9aa3ad' : '#c58b4e', dam = meo ? '#6b737d' : '#8a5a3b', s = meo ? 0.8 : 1;
  const than = new THREE.Group(); than.scale.setScalar(s); goc.add(than);
  khoi(than, 0.34, 0.3, 0.72, long, 0, 0.42, 0);
  if (meo) for (let i = 0; i < 3; i++) khoi(than, 0.35, 0.06, 0.08, dam, 0, 0.55, -0.2 + i * 0.2, false); else khoi(than, 0.35, 0.12, 0.3, '#f1e4d0', 0, 0.36, 0.1, false);
  const chan = [[-0.11, 0.26], [0.11, 0.26], [-0.11, -0.26], [0.11, -0.26]].map(([x, z]) => { const p = new THREE.Group(); p.position.set(x, 0.3, z); than.add(p); khoi(p, 0.1, 0.3, 0.1, dam, 0, -0.15, 0); return p; });
  const dau = new THREE.Group(); dau.position.set(0, 0.62, 0.42); than.add(dau);
  khoi(dau, 0.34, 0.3, 0.3, long, 0, 0, 0);
  khoi(dau, meo ? 0.16 : 0.2, meo ? 0.1 : 0.14, meo ? 0.08 : 0.2, meo ? '#c4cad3' : '#e7c9a0', 0, -0.06, 0.18); khoi(dau, 0.07, 0.05, 0.04, '#1d1a22', 0, -0.02, meo ? 0.22 : 0.29, false);
  for (const b of [-1, 1]) { khoi(dau, 0.05, 0.06, 0.02, '#1d1a22', b * 0.08, 0.05, 0.155, false); khoi(dau, meo ? 0.08 : 0.08, meo ? 0.12 : 0.18, 0.06, dam, b * 0.12, meo ? 0.2 : 0.08, -0.04, false).rotation.z = b * (meo ? 0.15 : -0.3); }
  const duoi = new THREE.Group(); duoi.position.set(0, 0.52, -0.36); than.add(duoi);
  khoi(duoi, 0.07, meo ? 0.5 : 0.08, meo ? 0.07 : 0.34, dam, 0, meo ? 0.25 : 0.04, meo ? -0.02 : -0.17);
  return { goc, dau, duoi, chan };
}
type Trex = { goc: THREE.Group; dau: THREE.Group; duoi: THREE.Group; chan: THREE.Group[]; tay: THREE.Group[] };
function trexMesh(): Trex {
  const goc = new THREE.Group(), da = '#5a8f3c', dam = '#3f6a28', bung = '#c5d98a';
  const than = new THREE.Group(); goc.add(than);
  khoi(than, 0.55, 0.55, 0.9, da, 0, 0.85, -0.05); // torso
  khoi(than, 0.45, 0.35, 0.55, bung, 0, 0.7, 0.05, false); // belly
  const dau = new THREE.Group(); dau.position.set(0, 1.25, 0.55); than.add(dau);
  khoi(dau, 0.48, 0.38, 0.55, da, 0, 0, 0); // head
  khoi(dau, 0.42, 0.16, 0.4, '#2a3d1f', 0, -0.12, 0.12, false); // jaw
  for (const b of [-1, 1]) {
    khoi(dau, 0.06, 0.06, 0.04, '#1d1a22', b * 0.12, 0.08, 0.26, false); // eyes
    khoi(dau, 0.05, 0.1, 0.04, '#e8eecf', b * 0.1, -0.08, 0.28, false); // teeth hint
  }
  const tay = [-1, 1].map((s) => {
    const p = new THREE.Group(); p.position.set(s * 0.32, 0.85, 0.2); than.add(p);
    khoi(p, 0.08, 0.22, 0.08, dam, 0, -0.05, 0); return p;
  });
  const chan = [-1, 1].map((s) => {
    const p = new THREE.Group(); p.position.set(s * 0.18, 0.55, -0.05); than.add(p);
    khoi(p, 0.16, 0.55, 0.22, dam, 0, -0.25, 0); khoi(p, 0.22, 0.08, 0.28, '#2f4a1c', 0, -0.52, 0.04, false); return p;
  });
  const duoi = new THREE.Group(); duoi.position.set(0, 0.85, -0.55); than.add(duoi);
  khoi(duoi, 0.22, 0.22, 0.7, da, 0, 0, -0.3); khoi(duoi, 0.12, 0.12, 0.35, dam, 0, 0.02, -0.7);
  goc.scale.setScalar(1.15);
  return { goc, dau, duoi, chan, tay };
}
interface Fig { e: Ent; g: THREE.Group; hinh?: Hinh; pet?: Pet; trex?: Trex; el: HTMLDivElement; bb: HTMLSpanElement; ten: HTMLElement; phu: HTMLElement; nhan: CSS2DObject;
  lookId: string; pha: number; x: number; z: number; heading: number; fallFrom?: [number, number]; bubble: string }
/** Short act bit under the name — only when it adds info beyond the name. */
const ACT_LABEL: Partial<Record<Ent['act'], string>> = { drink: 'cà phê', beer: 'trà đá', bark: 'sủa', fight: 'cãi', report: 'alert', massage: 'mát xa', knocked: 'ngã', bbq: 'BBQ', romance: 'hẹn hò', smoke: 'hút thuốc', gym: 'gym', atm: 'ATM', gate: 'cổng', pod: 'pod họp', print: 'máy in', drama: 'drama', bia: 'Hải Xồm', wobble: 'say', shipper: 'shipper', hunt: 'săn', chomp: 'ăn', carry: 'tha', carried: 'bị tha' };
const ROLE: Partial<Record<Ent['kind'], string>> = { dog: 'chó', cat: 'mèo', trex: 'T-Rex', boss: 'sếp', shipper: 'shipper' };

export class TownLayer {
  private world: World; private lastStep = 0; private figs = new Map<string, Fig>(); private itops?: ItOpsStatus; private eatUntil = 0;
  private agentPrey: AgentPrey[] = []; private pendingLayoff?: LayoffEvent;
  private p: ReturnType<typeof pond>; private traffic: Traffic; private cars: TrafficLayer; private k: ReturnType<typeof noc>; private nocKey = '';
  private hearts: HeartFX; private heartCd = 0;
  private rainG = new THREE.Group(); private rainDrops: THREE.Mesh[] = []; private flood?: THREE.Mesh; private rainOn = false;
  constructor(private ctx: TownCtx, now = Date.now()) {
    ground(ctx); cafe(ctx); massage(ctx); xemNuong(ctx); garden(ctx); trada(ctx); smokeCorner(ctx); gymYard(ctx); atmSnack(ctx); securityGate(ctx);
    biaHaiXom(ctx); meetingPod(ctx); printKiosk(ctx); this.p = pond(ctx); this.k = noc(ctx);
    this.hearts = new HeartFX(ctx.nhom);
    // Soft rain streaks + a wet patch by the crocodile pond (readable, not a particle storm).
    ctx.nhom.add(this.rainG); this.rainG.visible = false;
    for (let i = 0; i < 48; i++) {
      const d = khoi(this.rainG, 0.02, 0.35 + Math.random() * 0.25, 0.02, '#90caf9', (Math.random() - 0.5) * 36, 4 + Math.random() * 5, (Math.random() - 0.5) * 28, false);
      d.material = vatLieu('#90caf9', { transparent: true, opacity: 0.45 });
      this.rainDrops.push(d);
    }
    const [pcx, pcz] = toWorld(pondCenter());
    this.flood = khoi(ctx.nhom, 6.5, 0.02, 4.2, vatLieu('#5b8fa8', { transparent: true, opacity: 0.35 }), pcx + 1.2, 0.04, pcz + 0.4, false);
    this.flood.visible = false;
    this.world = initialWorld(now); this.lastStep = now; this.traffic = initialTraffic(now); this.cars = new TrafficLayer(ctx.nhom);
    // Screenshot/debug hook, opt-in via localStorage 'vp-debug' = '1': trigger a crash/fire or a garden affair.
    try { if (localStorage.getItem('vp-debug') === '1') {
      const w = window as unknown as Record<string, unknown>;
      w.__vpTraffic = { crash: (x = 700) => { this.traffic = forceCrash(this.traffic, Date.now(), x); }, fire: (x = 1000) => { this.traffic = forceFire(this.traffic, Date.now(), x); } };
      w.__vpTown = {
        romance: () => { this.world = forceRomance(this.world, Date.now(), Math.random); },
        drama: (kind: 'smoke' | 'gym' | 'atm' | 'print' | 'pod' | 'gate' = 'smoke') => { this.world = forceDrama(this.world, Date.now(), kind, Math.random); },
        hearts: (x = 0, z = -14.5) => { this.hearts.burst(x, z, Date.now(), true); },
        layoff: (mode: 'eat' | 'pond' | 'hunt' = 'hunt') => { this.world = forceLayoff(this.world, Date.now(), mode, Math.random); },
        layoffEat: () => { this.world = forceLayoff(this.world, Date.now(), 'eat', Math.random); },
        layoffPond: () => { this.world = forceLayoff(this.world, Date.now(), 'pond', Math.random); },
      };
    }; } catch { /* no storage */ }
    for (const e of this.world.ents) this.figs.set(e.id, this.fig(e));
    this.setItops(undefined);
    try { window.addEventListener(VP_LABELS_EVENT, this.onLabelsChanged); } catch { /* no window */ }
  }
  private onLabelsChanged = () => { this.refreshLabels(); };
  disposeLabelsListener() { try { window.removeEventListener(VP_LABELS_EVENT, this.onLabelsChanged); } catch { /* */ } }
  /** Pond centre in world units (thrown agents fly here). */
  get pondAt(): THREE.Vector3 { return new THREE.Vector3(this.p.cx, 0.2, this.p.cz); }
  /** Crocodiles chomp + splash for a while (an agent was thrown in). */
  eat(nowMs: number, ms = 2600) { this.eatUntil = Math.max(this.eatUntil, nowMs + ms); }
  throwEnt(id: string, nowMs = Date.now()) { this.world = throwIntoPond(this.world, id, nowMs); }
  /** Free office agents (plan px) Layoff may hunt. */
  setAgentPrey(list: AgentPrey[]) { this.agentPrey = list; }
  consumeLayoffEvent(): LayoffEvent | undefined { const e = this.pendingLayoff; this.pendingLayoff = undefined; return e; }
  /** Sếp đột nhập active — office agents sit up / whisper. */
  get bossActive(): boolean { return !!(this.world.bossUntil && this.world.bossUntil > Date.now()); }
  isRaining(): boolean { return this.world.weather === 'rain'; }
  get payday(): boolean { return !!this.world.payday; }
  /** Traffic state (screenshots / debugging can inject incidents). */
  get road() { return this.traffic; }
  set road(t: Traffic) { this.traffic = t; }
  ent(id: string) { return this.world.ents.find((e) => e.id === id); }
  setItops(s?: ItOpsStatus) {
    this.itops = s;
    const un = !s || s.mode === 'unconfigured', st = un ? 'idle' : s!.state;
    const label = un ? 'chưa cấu hình' : st === 'alert' ? `${s!.alerts.length} cảnh báo` : st === 'error' ? 'lỗi đọc metrics' : st === 'checking' ? 'đang kiểm tra…' : 'ổn định';
    const mode = s?.mode === 'demo' ? 'Monitor (demo)' : s?.mode === 'prometheus' ? 'Monitor · Prometheus' : 'Monitor';
    const show = monitorLabelVisible(s);
    const key = `${st}|${label}|${mode}|${s?.endpoint ?? ''}|${show}`; if (key === this.nocKey) return; this.nocKey = key;
    const el = this.k.el; el.className = `nhan-phong-3d nhan-pho noc-${st}`; (el.childNodes[1] as Text).textContent = mode; this.k.b.textContent = label;
    el.title = s?.endpoint ? `${s.endpoint} · ${s.query ?? ''}` : 'Set OFFICE_PROMETHEUS_URL';
    applyLabelVisibility(el, show);
    const c = st === 'ok' ? '#22c55e' : st === 'alert' || st === 'error' ? '#ef4444' : st === 'checking' ? '#f59e0b' : '#94a3b8';
    this.k.man.emissive.set(c); this.k.den.emissive.set(c); this.k.den.color.set(c); this.k.den.emissiveIntensity = st === 'idle' ? 0.3 : 0.9;
  }
  /** Re-apply every structure label from current prefs (Settings toggle / localStorage). */
  refreshLabels() {
    const prefs = loadLabels();
    for (const el of document.querySelectorAll<HTMLElement>('[data-label]')) {
      const key = el.dataset.label as LabelKey | undefined;
      if (!key) continue;
      if (key === 'monitor') applyLabelVisibility(el, monitorLabelVisible(this.itops, prefs));
      else applyLabelVisibility(el, isLabelOn(key, prefs));
    }
  }
  private lookOf(e: Ent) { return currentLook(`npc:${e.id}`) ?? e.look ?? ''; }
  private fig(e: Ent): Fig {
    const g = new THREE.Group(); this.ctx.nhom.add(g);
    const animal = e.kind === 'dog' || e.kind === 'cat', dino = e.kind === 'trex', lookId = this.lookOf(e);
    let hinh: Hinh | undefined, pet: Pet | undefined, trex: Trex | undefined;
    if (dino) { trex = trexMesh(); g.add(trex.goc); }
    else if (animal) { pet = petMesh(e.kind === 'cat'); g.add(pet.goc); }
    else { hinh = dungNguoi(presetLook(lookId), false); g.add(hinh.goc); }
    const el = document.createElement('div'); el.className = `nguoi-3d ent-3d ent-${e.kind}`; el.dataset.ent = e.id; el.dataset.testid = `ent-${e.id}`;
    el.innerHTML = '<div class="bong-3d"><span class="bb"></span></div><div class="ten-3d"><i class="cham-3d"></i><b></b><small></small></div>';
    const nhan = new CSS2DObject(el); nhan.center.set(0.5, 1); nhan.position.set(0, dino ? 2.2 : animal ? 1.05 : 2.05, 0); g.add(nhan);
    const [x, z] = toWorld(e);
    const f: Fig = { e, g, hinh, pet, trex, el, bb: el.querySelector('.bb')!, ten: el.querySelector('.ten-3d b')!, phu: el.querySelector('.ten-3d small')!, nhan, lookId, pha: Math.random() * 10, x, z, heading: 0, bubble: '\u0000' };
    g.position.set(x, 0, z); return f;
  }
  /** Rebuild a side character's body when its chosen preset changed. */
  private relook(f: Fig) {
    if (!f.hinh) return; const id = this.lookOf(f.e); if (id === f.lookId) return;
    f.g.remove(f.hinh.goc); f.hinh = dungNguoi(presetLook(id), false); f.g.add(f.hinh.goc); f.lookId = id;
  }
  /** Advance the simulation (every 200 ms) and animate every frame. */
  tick(t: number, dt: number, nowMs: number) {
    if (nowMs - this.lastStep >= 200) {
      this.world = step(this.world, nowMs, Math.random, this.itops, this.agentPrey); this.lastStep = nowMs;
      if (this.world.layoffEvent) { this.pendingLayoff = this.world.layoffEvent; this.world = { ...this.world, layoffEvent: undefined }; }
      // Chomp on-spot: splash-less hide; pond carry triggers eat splash when victim falls.
      if (this.world.ents.some((e) => e.act === 'chomp' || (e.kind === 'trex' && e.act === 'idle' && e.partner))) { /* noop */ }
      const peds = this.world.ents.filter((e) => (e.act === 'walk' || e.act === 'idle') && onRoad(e));
      const o = stepTraffic(this.traffic, nowMs, Math.random, peds); this.traffic = o.traffic;
      for (const id of o.hits) this.world = knockDown(this.world, id, nowMs, Math.random);
    }
    this.cars.update(this.traffic, t, dt);
    let eating = nowMs < this.eatUntil;
    // Sync rain / flooded pond path.
    const raining = this.world.weather === 'rain';
    if (raining !== this.rainOn) {
      this.rainOn = raining; this.rainG.visible = raining;
      if (this.flood) this.flood.visible = raining;
      try { this.ctx.nhom.parent; } catch { /* */ }
    }
    if (raining) {
      for (const d of this.rainDrops) {
        d.position.y -= dt * (6 + (d.position.x % 3 + 3));
        if (d.position.y < 0.2) d.position.y = 5 + Math.random() * 4;
      }
    }
    // Drop figs for removed ents (boss/shipper left).
    for (const id of [...this.figs.keys()]) {
      if (!this.world.ents.some((e) => e.id === id)) {
        const f = this.figs.get(id)!; this.ctx.nhom.remove(f.g); this.figs.delete(id);
      }
    }
    for (const e of this.world.ents) {
      let f = this.figs.get(e.id);
      if (!f) { f = this.fig(e); this.figs.set(e.id, f); }
      const prev = f.e.act; f.e = e; this.relook(f);
      if (e.act === 'eaten') eating = true;
      if (e.act === 'chomp' && e.kind === 'trex') { /* jaw anim via pose */ }
      if (e.act === 'carried') { /* held by Layoff */ }
      if (e.act === 'fall' && prev !== 'fall') f.fallFrom = [f.x, f.z];
      const hidden = e.act === 'eaten' || e.act === 'gone'; f.g.visible = !hidden; f.el.style.display = hidden ? 'none' : '';
      if (hidden) continue;
      const [tx, tz] = toWorld(e), dx = tx - f.x, dz = tz - f.z, kk = Math.min(1, dt * 6);
      if (Math.abs(dx) + Math.abs(dz) > 6 && e.act !== 'fall') { f.x = tx; f.z = tz; } else { f.x += dx * kk; f.z += dz * kk; } // respawn: jump
      const moving = Math.hypot(dx, dz) > 0.05;
      if (moving) f.heading = Math.atan2(dx, dz);
      else if (e.act === 'fight') { const o = this.world.ents.find((z) => z.kind === (e.kind === 'cat' ? 'dog' : 'cat')); if (o) { const [ox, oz] = toWorld(o); f.heading = Math.atan2(ox - f.x, oz - f.z); } }
      else if (e.kind === 'itops' && e.act === 'report') f.heading = Math.PI * 0.15;
      f.g.rotation.y = THREE.MathUtils.lerp(f.g.rotation.y, f.heading, Math.min(1, dt * 8));
      let y = 0;
      if (e.act === 'fall' && f.fallFrom) { const [cx, cz] = toWorld(pondCenter()), tot = Math.hypot(cx - f.fallFrom[0], cz - f.fallFrom[1]) || 1, p = 1 - Math.hypot(cx - f.x, cz - f.z) / tot; y = Math.sin(Math.max(0, Math.min(1, p)) * Math.PI) * Math.min(4, 1 + tot * 0.3); f.g.rotation.x = p * 8; } else f.g.rotation.x = 0;
      if (e.act === 'knocked') { f.g.rotation.x = THREE.MathUtils.lerp(f.g.rotation.x, -Math.PI / 2, 1); y = 0.15; }
      if (e.act === 'carried') { y = 1.1; f.g.rotation.x = 0.4; }
      if (e.act === 'massage') { f.g.rotation.x = -Math.PI / 2; y = 0.72; f.heading = 0; }
      if (e.act === 'bbq') { /* sit-ish: slight lean */ }
      if (e.act === 'romance' && e.partner) {
        const o = this.world.ents.find((z) => z.id === e.partner); if (o) { const [ox, oz] = toWorld(o); f.heading = Math.atan2(ox - f.x, oz - f.z); }
        if (nowMs > this.heartCd) { this.hearts.burst(f.x, f.z, nowMs); this.heartCd = nowMs + 900; }
      }
      f.g.position.set(f.x, y, f.z);
      this.pose(f, t, dt, moving);
      // label + bubble
      const name = currentName(`npc:${e.id}`) ?? e.name; if (f.ten.textContent !== name) f.ten.textContent = name;
      const phu = ROLE[e.kind] ?? ACT_LABEL[e.act] ?? '';
      if (f.phu.textContent !== phu) f.phu.textContent = phu;
      const alert = e.kind === 'itops' && e.act === 'report';
      const key = `${e.say ?? ''}|${alert}`;
      if (key !== f.bubble) { f.bubble = key; f.bb.textContent = e.say ?? ''; f.el.classList.toggle('co-bong', !!e.say); f.el.classList.toggle('bao-dong', alert); }
      if (f.el.dataset.act !== e.act) f.el.dataset.act = e.act;
    }
    this.animatePond(t, dt, eating);
  }
  private pose(f: Fig, t: number, dt: number, moving: boolean) {
    const w = t + f.pha, a = f.e.act, k = Math.min(1, dt * 10);
    if (f.trex) {
      const T = f.trex, sw = moving || a === 'hunt' || a === 'carry' ? Math.sin(w * 10) * 0.45 : 0;
      T.chan.forEach((c, i) => { c.rotation.x = (i === 0 ? 1 : -1) * sw; });
      T.duoi.rotation.y = Math.sin(w * 6) * 0.25;
      T.tay.forEach((c, i) => { c.rotation.x = Math.sin(w * 8 + i) * 0.15; });
      T.dau.rotation.x = a === 'chomp' ? -0.45 * Math.abs(Math.sin(w * 14)) : a === 'hunt' ? -0.15 : 0;
      T.goc.position.y = a === 'chomp' ? Math.abs(Math.sin(w * 14)) * 0.12 : moving ? Math.abs(Math.sin(w * 10)) * 0.06 : 0;
      T.goc.scale.setScalar(a === 'chomp' ? 1.15 + 0.05 * Math.sin(w * 14) : 1.15);
      return;
    }
    if (f.pet) {
      const P = f.pet, sw = moving ? Math.sin(w * 16) * 0.7 : 0;
      P.chan.forEach((c, i) => { c.rotation.x = (i === 0 || i === 3 ? 1 : -1) * sw; });
      P.duoi.rotation.y = Math.sin(w * (f.e.kind === 'dog' ? 18 : 4)) * 0.5;
      P.goc.position.y = a === 'fight' ? Math.abs(Math.sin(w * 14)) * 0.25 : a === 'bark' ? Math.abs(Math.sin(w * 10)) * 0.08 : moving ? Math.abs(Math.sin(w * 16)) * 0.04 : 0;
      P.goc.rotation.z = a === 'fight' ? Math.sin(w * 22) * 0.25 : 0;
      P.dau.rotation.x = a === 'bark' ? -0.3 * Math.abs(Math.sin(w * 10)) : 0;
      return;
    }
    const h = f.hinh!; let than = 0, tT = 0.05, tP = 0.05, chan = 0, dau = 0, noi = !!f.e.say;
    if (moving) { const s = Math.sin(w * (f.e.speed > 160 ? 11 : 7)); chan = 0.8 * s; tT = -0.8 * s; tP = 0.8 * s; than = 0.12; }
    else if (a === 'drink' || a === 'beer') { tP = -1.9 + 0.35 * Math.max(0, Math.sin(w * 0.9)); dau = -0.08 * Math.max(0, Math.sin(w * 0.9)); }
    else if (a === 'report' && f.e.kind === 'itops') { tP = -2.4 + 0.3 * Math.sin(w * 9); tT = -0.6 + 0.3 * Math.sin(w * 7); } // waving the alert
    else if (a === 'chat') { tP = -0.7 + 0.35 * Math.sin(w * 3); tT = -0.25 + 0.2 * Math.sin(w * 2.3); }
    else if (a === 'fall') { tT = tP = -2.9; }
    else if (a === 'massage') { tT = tP = -0.2; }
    else if (a === 'bbq' || a === 'atm' || a === 'print') { tP = -1.7 + 0.25 * Math.max(0, Math.sin(w * 0.8)); tT = -0.3; dau = -0.05; }
    else if (a === 'gym') { tT = -1.4 + 0.4 * Math.sin(w * 5); tP = -1.4 + 0.4 * Math.sin(w * 5 + Math.PI); }
    else if (a === 'smoke' || a === 'gate' || a === 'pod' || a === 'drama') { tP = -0.9 + 0.2 * Math.sin(w * 2); tT = -0.35; dau = -0.05; }
    else if (a === 'romance') { tP = -0.9; tT = -0.9; than = 0.15; dau = -0.12; }
    else if (f.e.kind === 'itops') { tT = tP = -1.1; dau = 0.15; } // typing at the indoor panel
    h.chan[0].rotation.x = THREE.MathUtils.lerp(h.chan[0].rotation.x, chan, k); h.chan[1].rotation.x = THREE.MathUtils.lerp(h.chan[1].rotation.x, -chan, k);
    h.than.rotation.x = THREE.MathUtils.lerp(h.than.rotation.x, than, k); h.dau.rotation.x = THREE.MathUtils.lerp(h.dau.rotation.x, dau, k);
    h.tay[0].rotation.x = THREE.MathUtils.lerp(h.tay[0].rotation.x, tT, k); h.tay[1].rotation.x = THREE.MathUtils.lerp(h.tay[1].rotation.x, tP, k);
    h.mieng.scale.y = noi ? 1 + 2.4 * Math.abs(Math.sin(w * 13)) : 1;
    const chop = ((w * 0.27) % 1) < 0.035; for (const m of h.mat) m.scale.y = chop ? 0.15 : 1;
    h.moHoi.visible = a === 'fall' || (f.e.kind === 'itops' && a === 'report');
  }
  private animatePond(t: number, dt: number, eating: boolean) {
    const { cx, cz, rx, rz, crocs, splash } = this.p;
    crocs.forEach((c, i) => {
      const chomp = eating && i === 0;
      let x: number, z: number, hd: number;
      if (chomp) { x = cx; z = cz - 0.6; hd = 0; } else {
        c.a += dt * c.v; x = cx + Math.cos(c.a) * rx * c.r; z = cz + Math.sin(c.a) * rz * c.r;
        hd = Math.atan2(-Math.sin(c.a) * rx, Math.cos(c.a) * rz); // tangent
      }
      c.g.position.x = THREE.MathUtils.lerp(c.g.position.x || x, x, Math.min(1, dt * 3)); c.g.position.z = THREE.MathUtils.lerp(c.g.position.z || z, z, Math.min(1, dt * 3));
      c.g.position.y = 0.1 + Math.sin(t * 1.5 + i) * 0.03; c.g.rotation.y = THREE.MathUtils.lerp(c.g.rotation.y, hd, Math.min(1, dt * 4));
      c.ham.rotation.x = chomp ? -0.2 - 0.5 * Math.abs(Math.sin(t * 9)) : -0.05 - 0.08 * Math.max(0, Math.sin(t * 0.7 + i * 2));
    });
    splash.visible = eating;
    if (eating) { const p = (t * 1.3) % 1; splash.scale.setScalar(0.4 + p * 1.6); (splash.material as THREE.MeshBasicMaterial).opacity = 1 - p; }
  }
  dispose() { this.disposeLabelsListener(); for (const f of this.figs.values()) f.el.remove(); this.cars.dispose(); }
}
