// Ours: voxel vehicles on the main road + crash / fire / explosion effects, driven by ../town/traffic.ts (plan px → world).
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LANES, PX, toWorld } from '../town/map';
import { VEHICLES, type Traffic, type Vehicle, type VType } from '../town/traffic';
import { dungNguoi, khoi, vatLieu, vatLieuSang } from './characters';
import { MAU_SAN as PRESETS } from './nhanVat';

const wheel = (g: THREE.Object3D, x: number, z: number, r = 0.2, w = 0.14) => khoi(g, r * 2, r * 2, w, '#1d1d22', x, r, z);
const wheels = (g: THREE.Object3D, L: number, W: number, r = 0.2) => { for (const x of [-L / 2 + r + 0.1, L / 2 - r - 0.1]) for (const s of [-1, 1]) wheel(g, x, s * W / 2, r); };
const glass = '#9fd3f0';
/** Car-like body: chassis + cabin + windows + lights. Built facing +x. */
function car(g: THREE.Object3D, L: number, W: number, body: string, cab: string, cabL = L * 0.5, cabX = -L * 0.05, h = 0.45) {
  khoi(g, L, h, W, body, 0, 0.22 + h / 2, 0); khoi(g, cabL, 0.4, W * 0.9, cab, cabX, 0.22 + h + 0.2, 0);
  khoi(g, 0.02, 0.3, W * 0.8, glass, cabX + cabL / 2, 0.22 + h + 0.2, 0, false); for (const s of [-1, 1]) khoi(g, cabL * 0.8, 0.26, 0.02, glass, cabX, 0.22 + h + 0.2, s * W * 0.45, false);
  for (const s of [-1, 1]) { khoi(g, 0.03, 0.1, 0.14, vatLieuSang('#fff6c2'), L / 2, 0.4, s * W * 0.35, false); khoi(g, 0.03, 0.1, 0.14, vatLieuSang('#ff3b3b'), -L / 2, 0.4, s * W * 0.35, false); }
  wheels(g, L, W);
}
function rider(g: THREE.Object3D, x: number, y: number, look: string) {
  const p = (PRESETS as { id: string; ngoai_hinh: Parameters<typeof dungNguoi>[0] }[]).find((q) => q.id === look)?.ngoai_hinh;
  const h = dungNguoi(p, true); h.goc.scale.setScalar(0.7); h.goc.position.set(x, y, 0); h.goc.rotation.y = Math.PI / 2; g.add(h.goc);
}
const beacon = (g: THREE.Object3D, x: number, y: number, a: string, b: string) => { khoi(g, 0.12, 0.1, 0.18, vatLieuSang(a), x, y, -0.12, false); khoi(g, 0.12, 0.1, 0.18, vatLieuSang(b), x, y, 0.12, false); };
/** One voxel model per vehicle type; L = length in world units. */
export function vehicleMesh(type: VType): THREE.Group {
  const g = new THREE.Group(), L = VEHICLES[type].len / PX;
  switch (type) {
    case 'xe-may': case 'xe-om': {
      khoi(g, L * 0.8, 0.22, 0.2, type === 'xe-om' ? '#00b14f' : '#d23b3b', 0, 0.42, 0); wheel(g, -L * 0.35, 0, 0.17, 0.08); wheel(g, L * 0.35, 0, 0.17, 0.08); khoi(g, 0.05, 0.4, 0.4, '#3a3a44', L * 0.38, 0.7, 0);
      rider(g, -0.05, 0.25, type === 'xe-om' ? 'nam_04' : 'nu_04'); if (type === 'xe-om') { rider(g, -0.35, 0.25, 'nam_06'); khoi(g, 0.2, 0.1, 0.22, '#00b14f', -0.1, 1.25, 0); }
      break;
    }
    case 'xe-dap': khoi(g, L * 0.8, 0.05, 0.05, '#2563eb', 0, 0.45, 0); wheel(g, -L * 0.33, 0, 0.2, 0.04); wheel(g, L * 0.33, 0, 0.2, 0.04); rider(g, 0, 0.3, 'nam_03'); break;
    case 'oto-con': car(g, L, 0.95, '#e8e3d8', '#d8d2c4'); break;
    case 'taxi': car(g, L, 0.95, '#f5c518', '#f0bd10'); khoi(g, 0.3, 0.12, 0.2, '#ffffff', -0.1, 1.33, 0); break;
    case 'ban-tai': car(g, L, 1, '#7a8b99', '#6c7d8b', L * 0.35, L * 0.12); khoi(g, L * 0.4, 0.2, 0.9, '#3a3f45', -L * 0.25, 0.8, 0); break;
    case 'xe-buyt': { car(g, L, 1.1, '#2e7d32', '#2e7d32', L * 0.96, 0, 0.6); for (let i = 0; i < 6; i++) for (const s of [-1, 1]) khoi(g, 0.45, 0.3, 0.02, glass, -L / 2 + 0.5 + i * 0.62, 1.05, s * 0.56, false); khoi(g, 0.6, 0.14, 0.02, vatLieuSang('#ffd23b'), L / 2 - 0.5, 1.35, 0.56, false); break; }
    case 'oto-tai': car(g, L, 1.1, '#3f6fb5', '#3f6fb5', L * 0.25, L * 0.36, 0.5); khoi(g, L * 0.68, 1.1, 1.1, '#e9e5dc', -L * 0.15, 1.2, 0); break;
    case 'container': car(g, L, 1.1, '#444b55', '#c62828', L * 0.18, L * 0.4, 0.4); khoi(g, L * 0.76, 1.2, 1.15, '#d35400', -L * 0.11, 1.25, 0); for (let i = 0; i < 8; i++) khoi(g, 0.04, 1.1, 1.18, '#a84300', -L * 0.48 + i * L * 0.1, 1.25, 0, false); break;
    case 'tron-be-tong': { car(g, L, 1.05, '#555b66', '#f2f2f2', L * 0.22, L * 0.38, 0.4); const d = khoi(g, L * 0.6, 0.9, 0.9, '#f28c28', -L * 0.12, 1.2, 0); d.rotation.z = 0.25; for (let i = 0; i < 3; i++) khoi(g, 0.08, 0.95, 0.95, '#d9d9d9', -L * 0.3 + i * 0.5, 1.2, 0, false).rotation.z = 0.25; break; }
    case 'xe-rac': car(g, L, 1.05, '#2e8b57', '#2e8b57', L * 0.25, L * 0.36, 0.45); khoi(g, L * 0.66, 1, 1.05, '#3cb371', -L * 0.16, 1.1, 0); khoi(g, 0.3, 0.2, 0.3, '#7a5c3b', -L * 0.3, 1.7, 0.1); break;
    case 'xe-cau': { car(g, L, 1.05, '#f4b400', '#f4b400', L * 0.2, L * 0.38, 0.45); khoi(g, L * 0.5, 0.3, 0.4, '#e0a000', -L * 0.1, 0.95, 0); const boom = khoi(g, L * 0.9, 0.18, 0.18, '#f4b400', -L * 0.15, 1.6, 0); boom.rotation.z = 0.35; khoi(g, 0.03, 0.8, 0.03, '#222', L * 0.25, 1.4, 0, false); break; }
    case 'xe-lu': khoi(g, 0.9, 0.9, 1.2, '#9e9e9e', L * 0.3, 0.45, 0); khoi(g, L * 0.55, 0.5, 0.9, '#f4b400', -L * 0.15, 0.6, 0); khoi(g, 0.6, 0.55, 0.8, '#f4b400', -L * 0.2, 1.1, 0); wheel(g, -L * 0.35, 0.5, 0.3, 0.2); wheel(g, -L * 0.35, -0.5, 0.3, 0.2); break;
    case 'may-xuc': { for (const s of [-1, 1]) khoi(g, L * 0.6, 0.35, 0.3, '#2b2b2b', -0.2, 0.18, s * 0.45); khoi(g, L * 0.5, 0.4, 1, '#f4b400', -0.2, 0.55, 0); khoi(g, 0.6, 0.7, 0.7, '#f4b400', -0.35, 1.1, 0.12); khoi(g, 0.02, 0.4, 0.5, glass, -0.04, 1.15, 0.12, false);
      const arm = khoi(g, 1.4, 0.18, 0.18, '#e0a000', 0.7, 1.3, -0.25); arm.rotation.z = 0.5; const arm2 = khoi(g, 0.9, 0.16, 0.16, '#e0a000', 1.35, 0.95, -0.25); arm2.rotation.z = -1.1; khoi(g, 0.4, 0.35, 0.45, '#555', 1.55, 0.4, -0.25); break; }
    case 'may-ui': for (const s of [-1, 1]) khoi(g, L * 0.7, 0.35, 0.3, '#2b2b2b', -0.1, 0.18, s * 0.45); khoi(g, L * 0.6, 0.45, 1, '#f4b400', -0.1, 0.58, 0); khoi(g, 0.6, 0.6, 0.7, '#f4b400', -0.3, 1.1, 0); khoi(g, 0.12, 0.6, 1.4, '#777', L * 0.45, 0.32, 0); break;
    case 'xe-tang': { for (const s of [-1, 1]) { khoi(g, L, 0.45, 0.35, '#3b3f2b', 0, 0.23, s * 0.55); for (let i = 0; i < 5; i++) khoi(g, 0.3, 0.3, 0.37, '#22251a', -L / 2 + 0.35 + i * 0.6, 0.18, s * 0.55, false); }
      khoi(g, L * 0.85, 0.4, 1.2, '#556b2f', 0, 0.62, 0); khoi(g, 1.1, 0.4, 0.85, '#4b5e29', -0.1, 1.02, 0); khoi(g, 1.6, 0.12, 0.12, '#3b4a20', 1.2, 1.05, 0); khoi(g, 0.2, 0.06, 0.6, '#e23d3d', -0.1, 1.24, 0, false); break; }
    case 'ba-gac': khoi(g, 0.5, 0.25, 0.2, '#5d4037', L * 0.35, 0.45, 0); wheel(g, L * 0.4, 0, 0.18, 0.08); khoi(g, L * 0.6, 0.08, 1, '#8d6e63', -L * 0.15, 0.45, 0); for (const s of [-1, 1]) wheel(g, -L * 0.2, s * 0.45, 0.2, 0.08); khoi(g, 0.6, 0.8, 0.6, '#eceff1', -L * 0.15, 0.9, 0); rider(g, L * 0.25, 0.2, 'nam_06'); break;
    case 'cuu-thuong': car(g, L, 1.05, '#ffffff', '#ffffff', L * 0.3, L * 0.3, 0.6); khoi(g, L * 0.6, 0.7, 1.06, '#f7f7f7', -L * 0.18, 1.2, 0); for (const s of [-1, 1]) { khoi(g, 0.5, 0.14, 0.02, '#e53935', -L * 0.18, 1.2, s * 0.54, false); khoi(g, 0.14, 0.5, 0.02, '#e53935', -L * 0.18, 1.2, s * 0.54, false); } beacon(g, L * 0.3, 1.47, '#ff2d2d', '#2d6bff'); break;
    case 'cuu-hoa': car(g, L, 1.15, '#d32f2f', '#c62828', L * 0.25, L * 0.35, 0.6); khoi(g, L * 0.62, 0.55, 1.1, '#b71c1c', -L * 0.17, 1.1, 0); khoi(g, L * 0.75, 0.1, 0.3, '#cfd8dc', -L * 0.12, 1.5, 0); for (let i = 0; i < 6; i++) khoi(g, 0.04, 0.12, 0.3, '#90a4ae', -L * 0.45 + i * 0.4, 1.58, 0, false); beacon(g, L * 0.35, 1.5, '#ff2d2d', '#ff9a2d'); break;
    case 'canh-sat': car(g, L, 0.95, '#f5f5f5', '#1e3a8a'); for (const s of [-1, 1]) khoi(g, L * 0.9, 0.1, 0.02, '#1e3a8a', 0, 0.5, s * 0.48, false); beacon(g, -0.1, 1.33, '#ff2d2d', '#2d6bff'); break;
    case 'kiem-tra': car(g, L, 1, '#ff8f00', '#ff8f00', L * 0.5, -L * 0.05, 0.5); khoi(g, 0.5, 0.25, 0.4, '#37474f', -L * 0.2, 1.45, 0); khoi(g, 0.1, 0.1, 0.1, vatLieuSang('#7cff4d'), -L * 0.2, 1.62, 0, false); break;
    case 'xe-kem': car(g, L, 1, '#f8bbd0', '#ffffff', L * 0.4, L * 0.1, 0.5); khoi(g, 0.3, 0.4, 0.3, '#fff3e0', -L * 0.25, 1.45, 0); khoi(g, 0.4, 0.3, 0.4, '#f48fb1', -L * 0.25, 1.8, 0); break;
  }
  return g;
}
interface VFig { v: Vehicle; g: THREE.Group; body: THREE.Group; el: HTMLDivElement; bb: HTMLSpanElement; drivers: THREE.Group; fx: THREE.Group; flames: THREE.Mesh[]; smoke: THREE.Mesh[]; boom: THREE.Mesh; x: number; charred: boolean; bubble: string }
const CHAR = vatLieu('#2a2522');
export class TrafficLayer {
  private figs = new Map<number, VFig>();
  constructor(private nhom: THREE.Group) {}
  private make(v: Vehicle): VFig {
    const g = new THREE.Group(); this.nhom.add(g); const body = vehicleMesh(v.type); g.add(body);
    const L = VEHICLES[v.type].len / PX;
    const drivers = new THREE.Group(); g.add(drivers); drivers.visible = false;
    const look = ['nam_01', 'nam_04', 'nu_07', 'nam_06', 'nu_04'][v.id % 5];
    const p = (PRESETS as { id: string; ngoai_hinh: Parameters<typeof dungNguoi>[0] }[]).find((q) => q.id === look)?.ngoai_hinh;
    const d = dungNguoi(p, false); d.goc.position.set(0, 0, -0.95); drivers.add(d.goc);
    const fx = new THREE.Group(); g.add(fx); fx.visible = false;
    const flames = [0, 1, 2, 3, 4].map((i) => khoi(fx, 0.35, 0.5, 0.35, vatLieuSang(i % 2 ? '#ff7a1a' : '#ffd23b'), -L / 3 + (i * L) / 6, 1.2, (i % 2 ? 0.2 : -0.2), false));
    const smokeM = vatLieu('#4a4a4a', { transparent: true, opacity: 0.7 });
    const smoke = [0, 1, 2, 3, 4, 5].map((i) => khoi(fx, 0.5, 0.5, 0.5, smokeM, (i % 3 - 1) * 0.3, 1.6, 0, false));
    const boom = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.9 })); boom.visible = false; boom.position.y = 0.8; g.add(boom);
    const el = document.createElement('div'); el.className = 'nguoi-3d ent-3d ent-xe'; el.dataset.testid = `xe-${v.id}`; el.dataset.type = v.type;
    el.innerHTML = '<div class="bong-3d"><span class="bb"></span></div><div class="ten-3d"><b></b></div>';
    (el.querySelector('.ten-3d b') as HTMLElement).textContent = VEHICLES[v.type].name;
    const nhan = new CSS2DObject(el); nhan.center.set(0.5, 1); nhan.position.set(0, 2.2, 0); g.add(nhan);
    const [x] = toWorld(v);
    return { v, g, body, el, bb: el.querySelector('.bb')!, drivers, fx, flames, smoke, boom, x, charred: false, bubble: '\u0000' };
  }
  update(tr: Traffic, t: number, dt: number) {
    const live = new Set<number>();
    for (const v of tr.vs) {
      live.add(v.id); let f = this.figs.get(v.id); if (!f) { f = this.make(v); this.figs.set(v.id, f); }
      f.v = v; const [tx, tz] = toWorld(v); const dir = LANES[v.lane].dir;
      f.x = Math.abs(tx - f.x) > 4 ? tx : f.x + (tx - f.x) * Math.min(1, dt * 8);
      f.g.position.set(f.x, 0, tz); f.g.rotation.y = dir > 0 ? 0 : Math.PI;
      const st = v.state;
      f.drivers.visible = st === 'argue'; f.drivers.position.z = dir > 0 ? 1.9 : 0; // stand on the camera side of the car
      if (st === 'argue') { f.drivers.children[0].rotation.y = (Math.sin(t * 7 + v.id) * 0.3) + (v.id % 2 ? Math.PI / 2 : -Math.PI / 2); f.drivers.position.y = Math.abs(Math.sin(t * 9 + v.id)) * 0.08; }
      f.body.position.y = st === 'drive' && VEHICLES[v.type].len < 40 ? Math.abs(Math.sin(t * 12 + v.id)) * 0.03 : 0;
      const burning = st === 'fire' || st === 'boom' || st === 'wreck';
      f.fx.visible = burning;
      if (burning) {
        f.flames.forEach((m, i) => { m.visible = st !== 'wreck'; m.scale.y = 0.4 + Math.abs(Math.sin(t * 9 + i * 1.7)) * (st === 'boom' ? 1.6 : 0.8); m.position.y = 1 + m.scale.y / 2; });
        f.smoke.forEach((m, i) => { const p = (t * 0.45 + i / f!.smoke.length) % 1; m.position.y = 1.3 + p * 3.2; m.position.x = (i % 3 - 1) * 0.3 + p * 0.6; m.scale.setScalar(0.4 + p * (st === 'wreck' ? 0.6 : 1.1)); });
      }
      if (st === 'boom' || st === 'wreck') { if (!f.charred) { f.charred = true; f.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = CHAR; }); f.body.rotation.z = 0.08; } }
      f.boom.visible = st === 'boom'; if (st === 'boom') { const p = (t * 1.6) % 1; f.boom.scale.setScalar(0.8 + p * 2.4); (f.boom.material as THREE.MeshBasicMaterial).opacity = 0.95 - p * 0.7; }
      const key = v.say ?? '';
      if (key !== f.bubble) { f.bubble = key; f.bb.textContent = key; f.el.classList.toggle('co-bong', !!key); f.el.classList.toggle('bao-dong', st === 'argue' || burning); }
      if (f.el.dataset.state !== st) f.el.dataset.state = st;
    }
    for (const [id, f] of this.figs) if (!live.has(id)) { this.nhom.remove(f.g); f.el.remove(); f.g.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); }); this.figs.delete(id); }
  }
  dispose() { for (const f of this.figs.values()) f.el.remove(); this.figs.clear(); }
}
