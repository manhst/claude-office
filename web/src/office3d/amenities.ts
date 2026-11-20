// Ours (not from the reference): pantry with a coffee machine on the left, game room with a billiard table on the right.
// Built from the reference's voxel helpers (block/material/glowMaterial) so it matches its look. Positions come from adapter.ts FURNITURE.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { block, material, glowMaterial } from './characters';
import { FLOOR, COFFEE_MACHINE, FURNITURE, GAME_X0, PANTRY_X1, type Item } from './adapter';
import { applyLabelVisibility, isLabelOn, type LabelKey } from '../officeLabels';
type StructureLabel = Exclude<LabelKey, 'monitor'>;

export interface AmenityCtx {
  group: THREE.Group; soft: boolean; own: <T extends { dispose(): void }>(m: T) => T;
  /** Night lights (turned on by setNight) and lamp shades that glow at night. */
  lights: THREE.PointLight[]; shades: THREE.MeshLambertMaterial[];
  plant: (parent: THREE.Object3D, x: number, z: number, size?: number) => void;
}
const at = (parent: THREE.Object3D, f: Pick<Item, 'x' | 'z'>, rotY = 0) => { const g = new THREE.Group(); g.position.set(f.x, 0, f.z); g.rotation.y = rotY; parent.add(g); return g; };
function tiles(own: AmenityCtx['own']) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#e9eef2' : '#f7f9fb'; g.fillRect(i * 32, j * 32, 32, 32); }
  g.fillStyle = 'rgba(90, 110, 130, .18)'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 32 - 1, 0, 2, 128); g.fillRect(0, i * 32 - 1, 128, 2); }
  const t = own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function lamp(ctx: AmenityCtx, x: number, z: number, w: number, d: number, color: string, height = 2.35) {
  block(ctx.group, 0.03, 2.9 - height, 0.03, '#3a3a44', x, (2.9 + height) / 2, z, false);
  const shade = ctx.own(new THREE.MeshLambertMaterial({ color: color, emissive: '#ffd27a', emissiveIntensity: 0 }));
  block(ctx.group, w, 0.14, d, shade, x, height, z, false); ctx.shades.push(shade);
  if (ctx.soft) return; // software GL: every point light costs shader time; the glowing shade is enough
  const lamp = new THREE.PointLight('#ffd9a0', 0, 9, 1.6); lamp.position.set(x, height - 0.3, z); ctx.group.add(lamp); ctx.lights.push(lamp);
}
function label(ctx: AmenityCtx, text: string, sub: string, color: string, x: number, z: number, labelKey: StructureLabel) {
  const div = document.createElement('div'); div.className = 'room-label-3d'; div.style.setProperty('--tint', color); div.dataset.label = labelKey;
  const small = document.createElement('small'); small.textContent = sub;
  div.append(document.createElement('i'), document.createTextNode(text), small);
  applyLabelVisibility(div, isLabelOn(labelKey));
  const o = new CSS2DObject(div); o.center.set(0, 1); o.position.set(x, 0.1, z); ctx.group.add(o);
}

export function buildPantry(ctx: AmenityCtx) {
  const { group } = ctx, F = FURNITURE;
  const r = PANTRY_X1 - FLOOR.x0, s = FLOOR.z1 - FLOOR.z0, t = tiles(ctx.own); t.repeat.set(r / 2, s / 2);
  const floor = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(r, s)), ctx.own(new THREE.MeshLambertMaterial({ map: t })));
  floor.rotation.x = -Math.PI / 2; floor.position.set((FLOOR.x0 + PANTRY_X1) / 2, 0.006, (FLOOR.z0 + FLOOR.z1) / 2); floor.receiveShadow = !ctx.soft; group.add(floor);
  // fridge (back-left corner)
  const tl = at(group, F.fridge);
  block(tl, 0.8, 1.9, 0.7, '#e6eaf0', 0, 0.95, 0); block(tl, 0.82, 0.02, 0.72, '#c4cad3', 0, 1.3, 0, false);
  for (const y of [1.6, 0.9]) block(tl, 0.04, 0.32, 0.05, '#9aa3b0', 0.3, y, 0.37, false);
  block(tl, 0.07, 0.07, 0.01, '#ef4444', -0.15, 1.55, 0.355, false); block(tl, 0.07, 0.07, 0.01, '#3b82f6', -0.05, 1.45, 0.355, false);
  // counter along the back wall: cabinets, stone top, sink, microwave, shelf, coffee machine
  const q = at(group, F.counter), L = F.counter.hx * 2;
  block(q, L, 0.86, 0.62, '#f1ebe1', 0, 0.43, 0);
  for (let i = 0; i <= 7; i++) block(q, 0.02, 0.74, 0.01, '#d8cdbd', -L / 2 + 0.05 + i * (L - 0.1) / 7, 0.45, 0.315, false);
  block(q, L + 0.06, 0.05, 0.66, '#3d3a40', 0, 0.885, 0);
  block(q, 0.62, 0.02, 0.4, '#9aa3b0', -1.1, 0.905, 0.02, false); block(q, 0.05, 0.3, 0.05, '#c4cad3', -1.1, 1.05, -0.2); block(q, 0.05, 0.05, 0.18, '#c4cad3', -1.1, 1.2, -0.12);
  block(group, 1.2, 0.05, 0.28, '#b98b5e', COFFEE_MACHINE[0] - 0.2, 1.95, FLOOR.z0 + 0.14);
  ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'].forEach((c, i) => block(group, 0.11, 0.13, 0.11, c, COFFEE_MACHINE[0] - 0.6 + i * 0.27, 2.04, FLOOR.z0 + 0.14));
  const m = at(group, { x: COFFEE_MACHINE[0], z: COFFEE_MACHINE[2] });
  block(m, 0.42, 0.5, 0.38, '#2b2a30', 0, 1.16, 0); block(m, 0.22, 0.18, 0.22, '#5a3d2b', 0, 1.5, -0.04); block(m, 0.3, 0.12, 0.01, '#45444c', 0, 1.3, 0.195, false);
  block(m, 0.08, 0.06, 0.08, '#8a8f99', 0, 1.02, 0.14, false); block(m, 0.3, 0.03, 0.14, '#8a8f99', 0, 0.925, 0.14, false);
  block(m, 0.08, 0.08, 0.08, '#ffffff', 0, 0.98, 0.14); block(m, 0.04, 0.04, 0.01, glowMaterial('#3bff7a'), 0.12, 1.32, 0.2, false);
  for (const [dx, c] of [[0.4, '#ffffff'], [0.52, '#f59e0b'], [-0.38, '#ffffff']] as const) block(m, 0.09, 0.1, 0.09, c, dx, 0.96, 0.08);
  // water cooler (left wall)
  const wc = at(group, F.cooler);
  block(wc, 0.36, 0.9, 0.36, '#e9edf2', 0, 0.45, 0); block(wc, 0.3, 0.42, 0.3, material('#8fc9ff', { transparent: true, opacity: 0.75 }), 0, 1.12, 0, false);
  for (const [dz, c] of [[-0.06, '#3b82f6'], [0.06, '#ef4444']] as const) block(wc, 0.05, 0.05, 0.05, c, 0.2, 0.75, dz, false);
  // two tables with stools, fruit and mugs
  for (const [f, stool] of [[F.table1, '#f2994a'], [F.table2, '#2bb3a3']] as const) {
    const g = at(group, f);
    block(g, 1.0, 0.05, 1.0, '#d9b68f', 0, 0.74, 0); block(g, 0.08, 0.7, 0.08, '#5d5f6b', 0, 0.36, 0); block(g, 0.5, 0.03, 0.5, '#4a4c57', 0, 0.015, 0, false);
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { block(g, 0.36, 0.06, 0.36, stool, dx, 0.48, dz); block(g, 0.05, 0.45, 0.05, '#5d5f6b', dx, 0.23, dz); }
    block(g, 0.1, 0.11, 0.1, '#ffffff', 0.22, 0.82, 0.18);
  }
  const fr = at(group, F.table1);
  block(fr, 0.34, 0.06, 0.34, '#c98b5e', -0.1, 0.8, -0.1); [['#ef4444', -0.17, -0.15], ['#f59e0b', -0.03, -0.12], ['#84cc16', -0.1, -0.02]].forEach(([c, x, z]) => block(fr, 0.1, 0.1, 0.1, c as string, x as number, 0.88, z as number));
  // bookshelf (left wall, between windows)
  const b = at(group, F.shelf);
  block(b, 0.4, 1.8, 1.8, '#8a6f5a', 0, 0.9, 0);
  for (let i = 0; i < 4; i++) {
    block(b, 0.36, 0.04, 1.72, '#a88a72', 0.04, 0.2 + i * 0.42, 0, false);
    for (let k = 0; k < 9; k++) if ((i * 9 + k) % 4 !== 3) block(b, 0.26, 0.3, 0.12, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#e2e8f0'][(i * 5 + k) % 6], 0.08, 0.37 + i * 0.42, -0.75 + k * 0.18, false);
  }
  lamp(ctx, F.table1.x, F.table1.z, 0.5, 0.5, '#fff4d6'); lamp(ctx, F.table2.x, F.table2.z, 0.5, 0.5, '#fff4d6');
  ctx.plant(group, PANTRY_X1 - 0.7, FLOOR.z1 - 0.7, 1.1);
  label(ctx, 'Pantry', 'coffee · snacks', '#f59e0b', FLOOR.x0 + 0.8, FLOOR.z1 - 0.4, 'pantry');
}

export function buildGameRoom(ctx: AmenityCtx) {
  const { group } = ctx, F = FURNITURE;
  // billiard table, long side along z
  const p = at(group, F.pool), W = F.pool.hx * 2, D = F.pool.hz * 2;
  block(p, W * 0.92, 0.07, D * 0.92, material('#000000', { transparent: true, opacity: 0.18 }), 0, 0.012, 0, false);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(p, 0.16, 0.6, 0.16, '#5a3b28', sx * (W / 2 - 0.15), 0.3, sz * (D / 2 - 0.15));
  block(p, W, 0.22, D, '#6b4428', 0, 0.67, 0);
  block(p, W - 0.2, 0.03, D - 0.2, '#1f8a4c', 0, 0.79, 0);
  for (const sx of [-1, 1]) block(p, 0.09, 0.07, D - 0.2, '#17663a', sx * (W / 2 - 0.13), 0.815, 0, false);
  for (const sz of [-1, 1]) block(p, W - 0.2, 0.07, 0.09, '#17663a', 0, 0.815, sz * (D / 2 - 0.13), false);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) block(p, 0.13, 0.02, 0.13, '#111111', sx * (W / 2 - 0.13), 0.81, sz * (D / 2 - 0.13), false);
  const balls = ['#facc15', '#2563eb', '#dc2626', '#7c3aed', '#f97316', '#16a34a', '#7f1d1d', '#111111', '#fde047', '#60a5fa'];
  let k = 0; for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) block(p, 0.075, 0.075, 0.075, balls[k++ % balls.length], (i - row / 2) * 0.085, 0.84, 0.55 + row * 0.075, false);
  block(p, 0.075, 0.075, 0.075, '#f8fafc', 0.05, 0.84, -0.7, false);
  block(p, 0.03, 0.03, 1.45, '#c8a165', 0.32, 0.86, -0.1, false).rotation.y = 0.35;
  lamp(ctx, F.pool.x, F.pool.z, 0.55, 1.6, '#1f6f45', 2.2);
  // cue rack + dartboard on the back wall
  const z0 = FLOOR.z0;
  block(group, 0.6, 1.4, 0.05, '#8a6f5a', 8.2, 1.3, z0 + 0.03);
  for (let i = 0; i < 4; i++) block(group, 0.03, 1.3, 0.03, i % 2 ? '#c8a165' : '#a47b4f', 8.0 + i * 0.13, 1.25, z0 + 0.08, false);
  for (const [w, c] of [[0.5, '#1f2937'], [0.38, '#dc2626'], [0.26, '#f5f0e1'], [0.14, '#16a34a'], [0.05, '#dc2626']] as const) block(group, w, w, 0.02, c, 9.1, 1.65, z0 + 0.02 + (0.5 - w) * 0.04, false);
  // arcade cabinet (back-right corner)
  const a = at(group, F.arcade);
  block(a, 0.7, 1.7, 0.6, '#3b2b6b', 0, 0.85, 0); block(a, 0.5, 0.36, 0.01, glowMaterial('#55e0ff'), 0, 1.3, 0.305, false);
  block(a, 0.6, 0.08, 0.3, '#2a1f4d', 0, 0.98, 0.35); block(a, 0.06, 0.08, 0.06, '#ef4444', -0.12, 1.06, 0.38); block(a, 0.05, 0.03, 0.05, '#facc15', 0.12, 1.04, 0.38);
  block(a, 0.7, 0.16, 0.6, '#a855f7', 0, 1.62, 0.02, false);
  // lounge: rug, sofa facing the table, coffee table
  block(group, 3.4, 0.02, 2.6, '#c97c5d', F.sofa.x, 0.012, (F.sofa.z + F.coffeeTable.z) / 2, false);
  const sf = at(group, F.sofa), sw = F.sofa.hx * 2;
  block(sf, sw, 0.4, 0.9, '#4a5a8c', 0, 0.2, 0); block(sf, sw, 0.55, 0.2, '#3f4d7a', 0, 0.65, 0.35);
  for (const sx of [-1, 1]) { block(sf, 0.2, 0.62, 0.9, '#3f4d7a', sx * (sw / 2 - 0.1), 0.31, 0); block(sf, (sw - 0.45) / 2, 0.12, 0.66, '#5b6ca0', sx * (sw - 0.4) / 4, 0.46, -0.06); }
  block(sf, 0.36, 0.3, 0.12, '#f59e0b', -0.7, 0.7, 0.18).rotation.z = 0.15;
  const ct = at(group, F.coffeeTable);
  block(ct, 1.2, 0.06, 0.6, '#d9b68f', 0, 0.4, 0); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(ct, 0.06, 0.37, 0.06, '#8a6f5a', sx * 0.52, 0.185, sz * 0.24);
  block(ct, 0.3, 0.02, 0.22, '#3b82f6', -0.25, 0.44, 0.02, false); block(ct, 0.09, 0.1, 0.09, '#ffffff', 0.3, 0.48, -0.05);
  ctx.plant(group, FLOOR.x1 - 0.7, FLOOR.z1 - 0.7, 1.1); ctx.plant(group, GAME_X0 + 0.6, FLOOR.z1 - 0.7);
  label(ctx, 'Game room', 'billiards · darts', '#22c55e', GAME_X0 + 0.5, FLOOR.z1 - 0.4, 'game');
}
