// Vanphong office scene, ported from VanphongAI (Phuc) van_phong_3d.js. See ./NOTICE.
// Builders (floor, walls, windows, plants, desks, glass room, lamp), the per-state pose animation, the flying paper,
// day/night and the camera buttons are copied from the reference with small edits. What is ours: the state now comes
// from our reducer (update()), people walk with our walker (../walk.ts), and the server room, store-room door, reception,
// lobby, help-desk wandering and all server/API calls are gone. Also ours: gocMacDinh's camera fit, the idle poses, freeSince and the amenity wiring.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AgentUI, OfficeState } from '../reducer';
import { allDesks } from '../layout';
import { newWalker, resolveOverlaps, stepWalker, type LabelBox, type Walker } from '../walk';
import { khoi, tron, vatLieu, vatLieuSang, dungNguoi, setShadows, type Hinh } from './characters';
import { BIEN, DOOR, ROOM, ROOM_COLOR, idlePlans, isFree, lookFor, newFlights, subtitleFor, vpBubble, vpChair, vpGoal, vpPlan, vpStatus, type IdlePlan, type VpStatus } from './adapter';
import { buildGameRoom, buildPantry } from './amenities';

const BAN_CAO = 0.72;   // desk top
const NAP_MO = 0.25, NAP_DONG = -1.5; // laptop lid angles
const lerp = THREE.MathUtils.lerp;
const SVG = {
  dem: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.3A8 8 0 0 1 8.7 4a8 8 0 1 0 11.3 11.3Z"/></svg><span>Night</span>',
  ngay: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Day</span>',
  gan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  xa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>',
  goc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 12 7v3L7.5 6 12 2z"/></svg>',
};
/** Software rasterisers (SwiftShader/llvmpipe) can't afford shadows + MSAA. */
function softwareGL() {
  try { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info');
    return /swiftshader|llvmpipe|software/i.test(e ? String(c!.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''); } catch { return false; }
}

interface Ban { g: THREE.Group; nap: THREE.Group; manHinh: THREE.MeshLambertMaterial; logo: THREE.MeshLambertMaterial; hat: THREE.Mesh[]; cur: number }
interface Pose { than: number; dau: number; tT: number; tP: number; zT: number; zP: number }
interface Nguoi {
  id: string; ngoi: Hinh; dung: Hinh; ban: Ban | null; desk: { x: number; y: number }; nhan: CSS2DObject; el: HTMLDivElement;
  bongEl: HTMLDivElement; bbEl: HTMLSpanElement; tenEl: HTMLElement; phuEl: HTMLElement; choEl: HTMLElement;
  tt: VpStatus; noi: boolean; met: boolean; pha: number; cur: Pose; walker: Walker; seated: boolean; bb: string;
  /** ours: what the agent does while free (set once it has arrived), and whether its small-talk line is showing */
  idleKind?: IdlePlan['kind']; noiIdle: boolean;
}
interface Bay { m: THREE.Mesh; tu: THREE.Vector3; den: THREE.Vector3; bat: number; lau: number }

export class VanphongScene {
  private renderer: THREE.WebGLRenderer; private nhanR = new CSS2DRenderer(); private canh = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400); private dk: OrbitControls; private dongHo = new THREE.Clock();
  private troi = new THREE.HemisphereLight('#fffaf0', '#c8b49a', 1.6); private nang = new THREE.DirectionalLight('#fff1dc', 2.2);
  private kinhCua = new THREE.MeshLambertMaterial({ color: '#bfe3ff', emissive: '#cfeaff', emissiveIntensity: 0.35 });
  private rieng: { dispose(): void }[] = []; private denPhong: THREE.PointLight[] = []; private chaoDen: THREE.MeshLambertMaterial[] = [];
  private nhom = new THREE.Group(); private ban = new Map<string, Ban>(); private nguoi = new Map<string, Nguoi>(); private bay: Bay[] = [];
  private s: OfficeState | null = null; private idle: Record<string, IdlePlan> = {}; private freeSince: Record<string, number> = {}; private lastMsg = 0; private dem = false; private gocVe: null | { tuMay: THREE.Vector3; tuDich: THREE.Vector3; denMay: THREE.Vector3; denDich: THREE.Vector3; bat: number; lau: number } = null;
  private ro: ResizeObserver; private vung: HTMLDivElement; private nutDem: HTMLButtonElement; private soft = softwareGL();

  constructor(private khung: HTMLElement, private store?: Pick<Storage, 'getItem' | 'setItem'>) {
    setShadows(!this.soft);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.soft });
    khung.classList.add('vp-ref');
    khung.innerHTML = `<div class="vp3d-canh"></div>
      <div class="vp3d-cong-cu">
        <button type="button" class="nut-3d" data-3d="ngay-dem" data-testid="vp-daynight"></button>
        <button type="button" class="nut-3d" data-3d="gan" title="Zoom in" aria-label="Zoom in">${SVG.gan}</button>
        <button type="button" class="nut-3d" data-3d="xa" title="Zoom out" aria-label="Zoom out">${SVG.xa}</button>
        <button type="button" class="nut-3d" data-3d="goc" title="Reset view" aria-label="Reset view">${SVG.goc}</button>
      </div>
      <p class="vp3d-goi-y">Drag to rotate · scroll to zoom · right-drag to pan</p>`;
    this.vung = khung.querySelector('.vp3d-canh')!;
    this.nutDem = khung.querySelector('[data-3d="ngay-dem"]')!;
    const r = this.renderer;
    r.setPixelRatio(this.soft ? 0.85 : Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = !this.soft; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.vung.append(r.domElement);
    this.nhanR.domElement.className = 'vp3d-nhan';
    this.vung.append(this.nhanR.domElement);
    this.canh.background = new THREE.Color('#dfe9f1');
    this.canh.add(this.troi);
    this.nang.castShadow = !this.soft; this.nang.shadow.mapSize.set(2048, 2048); this.nang.shadow.bias = -0.0004; this.nang.shadow.normalBias = 0.02;
    this.canh.add(this.nang, this.nang.target);
    this.dk = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.dk, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 3.5, maxDistance: 60, minPolarAngle: 0.15, maxPolarAngle: 1.32, rotateSpeed: 0.7 });
    this.dk.addEventListener('change', () => this.giuTrongBien());
    this.dk.addEventListener('start', () => { this.gocVe = null; });
    this.canh.add(this.nhom);
    this.dung();
    const g = this.gocMacDinh(); this.camera.position.copy(g.may); this.dk.target.copy(g.dich); this.dk.update();
    const saved = store?.getItem('office.vp.night');
    const gio = new Date().getHours();
    this.datNgayDem(saved ? saved === '1' : gio < 6 || gio >= 18);
    this.ro = new ResizeObserver(() => this.doiCo()); this.ro.observe(this.vung); this.doiCo();
    khung.addEventListener('click', this.onClick);
    r.setAnimationLoop(() => this.veKhung());
  }

  private onClick = (e: Event) => {
    const nut = (e.target as HTMLElement).closest<HTMLElement>('[data-3d]'); if (!nut) return;
    const hd = nut.dataset['3d'];
    if (hd === 'ngay-dem') { this.datNgayDem(!this.dem); try { this.store?.setItem('office.vp.night', this.dem ? '1' : '0'); } catch { /* private mode */ } }
    else if (hd === 'gan') this.phong(0.7);
    else if (hd === 'xa') this.phong(1.4);
    else if (hd === 'goc') { const g = this.gocMacDinh(); this.diChuyenGoc(g.may, g.dich); }
  };

  private doiCo() {
    const w = this.vung.clientWidth, h = this.vung.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.nhanR.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  private own<T extends { dispose(): void }>(m: T) { this.rieng.push(m); return m; }

  // ---------- Static office (reference: anhSan, dungNen, cuaSo, cayCanh, dungPhong, choNgoi) ----------
  private anhSan() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!; const mau = ['#e8d6bd', '#e2ceb2', '#ecdcc6', '#ddc8ab'];
    for (let hang = 0; hang < 8; hang++) {
      let x = -((hang * 37) % 64), i = hang;
      while (x < 256) {
        const dai = 64 + ((hang * 13 + i * 7) % 3) * 32;
        g.fillStyle = mau[i % 4]; g.fillRect(x, hang * 32, dai, 32);
        g.fillStyle = 'rgba(120, 90, 60, .2)'; g.fillRect(x, hang * 32, 2, 32);
        x += dai; i++;
      }
      g.fillStyle = 'rgba(120, 90, 60, .22)'; g.fillRect(0, hang * 32 + 31, 256, 1);
    }
    const t = this.own(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  private cayCanh(cha: THREE.Object3D, x: number, z: number, co = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(co); cha.add(g);
    khoi(g, 0.36, 0.36, 0.36, '#c98b5e', 0, 0.18, 0);
    khoi(g, 0.4, 0.06, 0.4, '#b5764c', 0, 0.37, 0);
    khoi(g, 0.5, 0.4, 0.5, '#4caf6a', 0, 0.62, 0);
    khoi(g, 0.36, 0.34, 0.36, '#5cc27a', 0.04, 0.95, -0.02).rotation.y = 0.4;
    khoi(g, 0.22, 0.26, 0.22, '#6fd08b', -0.03, 1.2, 0.02).rotation.y = 0.8;
  }
  private cuaSo(x: number, z: number, xoay: number) {
    const g = new THREE.Group(); g.position.set(x, 1.55, z); g.rotation.y = xoay; this.nhom.add(g);
    khoi(g, 1.7, 1.2, 0.02, this.kinhCua, 0, 0, 0.01, false);
    const k = '#ffffff';
    khoi(g, 1.84, 0.07, 0.05, k, 0, 0.635, 0.02, false); khoi(g, 1.84, 0.07, 0.05, k, 0, -0.635, 0.02, false);
    for (const b of [-1, 1]) khoi(g, 0.07, 1.27, 0.05, k, b * 0.885, 0, 0.02, false);
    khoi(g, 0.05, 1.2, 0.04, k, 0, 0, 0.02, false); khoi(g, 1.94, 0.05, 0.16, k, 0, -0.68, 0.07, false);
  }
  /** Entrance door frame in the back wall where agents arrive (geometry from the reference's store-room door, no click action). */
  private cua(x: number, z: number) {
    const g = new THREE.Group(); g.position.set(x, 0, z + 0.006); this.nhom.add(g);
    const go = '#8a6f5a';
    khoi(g, 1.2, 2.15, 0.012, '#1d1a22', 0, 1.075, 0.006, false);
    for (const b of [-1, 1]) khoi(g, 0.12, 2.3, 0.14, go, b * 0.66, 1.15, 0.07);
    khoi(g, 1.44, 0.14, 0.14, go, 0, 2.3, 0.07);
    khoi(g, 1.5, 0.04, 0.3, '#6b5544', 0, 0.02, 0.15, false);
    const canh = new THREE.Group(); canh.position.set(-0.6, 0, 0.05); canh.rotation.y = -1.35; g.add(canh); // held open
    khoi(canh, 1.2, 2.15, 0.06, '#a77b54', 0.6, 1.075, 0);
    for (const y of [0.55, 1.5]) khoi(canh, 0.86, 0.66, 0.02, '#7a5c42', 0.6, y, 0.035, false);
    khoi(canh, 0.08, 0.08, 0.08, '#f2c14e', 1.08, 1.05, 0.06, false);
  }
  private dungNen(vatLieuSan: THREE.MeshLambertMaterial, anh: THREE.Texture) {
    const { x0, x1, z0, z1 } = BIEN, nhom = this.nhom;
    const r = x1 - x0, s = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    khoi(nhom, r + 0.4, 0.3, s + 0.4, '#cdb89c', cx, -0.15, cz, false);
    anh.repeat.set(r / 4, s / 4);
    const san = new THREE.Mesh(this.own(new THREE.PlaneGeometry(r, s)), vatLieuSan);
    san.rotation.x = -Math.PI / 2; san.position.set(cx, 0.002, cz); san.receiveShadow = !this.soft; nhom.add(san);
    const T = '#f4ede3', CAO = 2.7;
    khoi(nhom, r + 0.4, CAO, 0.2, T, cx, CAO / 2, z0 - 0.1);
    khoi(nhom, 0.2, CAO, s + 0.2, T, x0 - 0.1, CAO / 2, cz + 0.1);
    khoi(nhom, r + 0.44, 0.06, 0.26, '#e2d5c4', cx, CAO + 0.03, z0 - 0.1, false);
    khoi(nhom, 0.26, 0.06, s + 0.24, '#e2d5c4', x0 - 0.1, CAO + 0.03, cz + 0.1, false);
    khoi(nhom, r, 0.12, 0.03, '#d9cab6', cx, 0.06, z0 + 0.015, false);
    khoi(nhom, 0.03, 0.12, s, '#d9cab6', x0 + 0.015, 0.06, cz, false);
    khoi(nhom, 1.8, 0.02, 0.7, '#8a6f5a', DOOR[0], 0.01, z0 + 0.45, false); // doormat inside the entrance
    for (const x of [-10.6, -4.6, 4.6, 10.6]) this.cuaSo(x, z0 + 0.005, 0); // ours: wider floor, windows clear of the pantry/game furniture
    this.cua(DOOR[0], z0);
    for (let i = 0; i < 4; i++) this.cuaSo(x0 + 0.005, z0 + (i + 0.5) * s / 4, Math.PI / 2);
    this.cayCanh(nhom, DOOR[0] - 1.4, z0 + 0.45, 1.1); this.cayCanh(nhom, DOOR[0] + 1.4, z0 + 0.45, 1.1);
    this.cayCanh(nhom, x0 + 0.6, z1 - 0.6); this.cayCanh(nhom, x1 - 0.6, z1 - 0.6);
    const ctx = { nhom, soft: this.soft, own: <T extends { dispose(): void }>(m: T) => this.own(m), lights: this.denPhong, shades: this.chaoDen,
      plant: (cha: THREE.Object3D, x: number, z: number, co?: number) => this.cayCanh(cha, x, z, co) };
    buildPantry(ctx); buildGameRoom(ctx);
  }
  private choNgoi(cha: THREE.Object3D, x: number, z: number, mauPhong: string, i: number): Ban {
    const g = new THREE.Group(); g.position.set(x, 0, z); cha.add(g);
    const ghe = tron(mauPhong, '#2a2833', 0.45);
    khoi(g, 0.52, 0.08, 0.5, ghe, 0, 0.45, 0.08);
    khoi(g, 0.52, 0.56, 0.08, ghe, 0, 0.78, -0.22);
    khoi(g, 0.06, 0.38, 0.06, '#5d5f6b', 0, 0.22, 0.05);
    khoi(g, 0.56, 0.04, 0.08, '#4a4c57', 0, 0.03, 0.05, false);
    khoi(g, 0.08, 0.04, 0.56, '#4a4c57', 0, 0.03, 0.05, false);
    khoi(g, 1.5, 0.06, 0.72, '#d9b68f', 0, BAN_CAO - 0.03, 0.62);
    for (const b of [-1, 1]) khoi(g, 0.05, BAN_CAO - 0.06, 0.66, '#efe8dd', b * 0.7, (BAN_CAO - 0.06) / 2, 0.62);
    khoi(g, 1.36, 0.4, 0.03, '#efe8dd', 0, 0.42, 0.95);
    khoi(g, 0.52, 0.025, 0.34, '#d8dce5', 0, BAN_CAO + 0.012, 0.6);
    const nap = new THREE.Group(); nap.position.set(0, BAN_CAO + 0.025, 0.77); nap.rotation.x = NAP_MO; g.add(nap);
    khoi(nap, 0.52, 0.34, 0.022, '#d8dce5', 0, 0.17, 0);
    const manHinh = this.own(new THREE.MeshLambertMaterial({ color: '#1c2030', emissive: mauPhong, emissiveIntensity: 0.2 }));
    khoi(nap, 0.46, 0.28, 0.004, manHinh, 0, 0.17, -0.013, false);
    const logo = this.own(new THREE.MeshLambertMaterial({ color: '#aab1c2', emissive: mauPhong, emissiveIntensity: 0.1 }));
    khoi(nap, 0.08, 0.08, 0.004, logo, 0, 0.18, 0.013, false);
    khoi(g, 0.09, 0.11, 0.09, '#ffffff', 0.5, BAN_CAO + 0.055, 0.5);
    if (i % 2 === 0) khoi(g, 0.22, 0.04, 0.3, '#f7f4ee', -0.5, BAN_CAO + 0.02, 0.62).rotation.y = 0.2;
    else { khoi(g, 0.1, 0.1, 0.1, '#c98b5e', -0.55, BAN_CAO + 0.05, 0.72); khoi(g, 0.16, 0.14, 0.16, '#58b26a', -0.55, BAN_CAO + 0.17, 0.72); }
    const hat = [0, 1, 2].map(() => { const m = khoi(g, 0.06, 0.06, 0.06, vatLieuSang(tron(mauPhong, '#ffffff', 0.25)), 0, 1.2, 0.8, false); m.visible = false; return m; });
    return { g, nap, manHinh, logo, hat, cur: NAP_MO };
  }
  /** One glass room around our desk grid (reference dungPhong), door gap in the back wall facing the entrance. */
  private dungPhong() {
    const mau = ROOM_COLOR, { x0, x1, z0, z1, door } = ROOM;
    const g = new THREE.Group(); const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; g.position.set(cx, 0, cz); this.nhom.add(g);
    const rong = x1 - x0, sau = z1 - z0, nr = rong / 2, ns = sau / 2;
    khoi(g, rong, 0.03, sau, tron(mau, '#ffffff', 0.8), 0, 0.015, 0, false);
    const kinh = vatLieu(tron(mau, '#ffffff', 0.5), { transparent: true, opacity: 0.25, depthWrite: false });
    const vien = tron(mau, '#3a3346', 0.25);
    const CAO = 1.05;
    const vach = (w: number, d: number, x: number, z: number) => { khoi(g, w, CAO, d, kinh, x, CAO / 2 + 0.03, z, false); khoi(g, w, 0.06, d + 0.01, vien, x, CAO + 0.06, z, false); };
    vach(rong, 0.05, 0, ns); vach(0.05, sau, -nr, 0); vach(0.05, sau, nr, 0);
    const wSau = (rong - door) / 2;
    vach(wSau, 0.05, -nr + wSau / 2, -ns); vach(wSau, 0.05, nr - wSau / 2, -ns);
    for (const [px, pz] of [[-nr, -ns], [nr, -ns], [-nr, ns], [nr, ns], [-door / 2, -ns], [door / 2, -ns]]) khoi(g, 0.09, CAO + 0.12, 0.09, vien, px, (CAO + 0.12) / 2, pz);
    const lx = nr - 0.4, lz = -ns + 0.4;
    khoi(g, 0.3, 0.04, 0.3, '#5d5f6b', lx, 0.02, lz); khoi(g, 0.05, 1.6, 0.05, '#5d5f6b', lx, 0.8, lz);
    const chao = this.own(new THREE.MeshLambertMaterial({ color: '#fff4d6', emissive: '#ffd27a', emissiveIntensity: 0 }));
    khoi(g, 0.42, 0.26, 0.42, chao, lx, 1.72, lz); this.chaoDen.push(chao);
    const den = new THREE.PointLight('#ffd9a0', 0, Math.max(rong, sau) * 1.3, 1.6); den.position.set(0, 2.4, 0); g.add(den); this.denPhong.push(den);
    this.cayCanh(g, -nr + 0.4, -ns + 0.4, 0.8);
    allDesks().forEach((d, i) => { const [x, , z] = vpChair(d); this.ban.set(`${d.x},${d.y}`, this.choNgoi(this.nhom, x, z, mau, i)); });
    const div = document.createElement('div'); div.className = 'nhan-phong-3d'; div.style.setProperty('--mau', mau);
    div.append(document.createElement('i'), document.createTextNode('Work room'), document.createElement('small'));
    const nhan = new CSS2DObject(div); nhan.center.set(0, 1); nhan.position.set(-nr + 0.1, CAO + 0.2, ns); g.add(nhan);
    this.roomLabel = div.querySelector('small')!;
  }
  private roomLabel!: HTMLElement;
  private dung() {
    const anh = this.anhSan();
    const vatLieuSan = this.own(new THREE.MeshLambertMaterial({ map: anh }));
    this.dungNen(vatLieuSan, anh);
    this.dungPhong();
    const { x0, x1, z0, z1 } = BIEN, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const R = Math.hypot(x1 - x0, z1 - z0) / 2 + 1;
    this.nang.position.set(cx + R * 0.55, R * 1.3 + 6, cz + R * 0.8); this.nang.target.position.set(cx, 0, cz);
    Object.assign(this.nang.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 5 + 20 });
    this.nang.shadow.camera.updateProjectionMatrix();
  }

  // ---------- People: our agents, reference look + labels ----------
  private themNguoi(a: AgentUI): Nguoi {
    const look = lookFor(a);
    const ngoi = dungNguoi(look, true), dung = dungNguoi(look, false);
    const chair = vpChair(a.desk); ngoi.goc.position.set(chair[0], 0, chair[2]); ngoi.goc.visible = false;
    this.nhom.add(ngoi.goc, dung.goc);
    const el = document.createElement('div');
    el.className = 'nguoi-3d'; el.dataset.nv = a.id; el.dataset.testid = `vp-agent-${a.id}`; el.style.setProperty('--mau', look.phu ?? ROOM_COLOR);
    // Static markup only; every dynamic string goes through textContent.
    el.innerHTML = '<div class="bong-3d"><span class="bb"></span></div><div class="zzz-3d" aria-hidden="true"><span>Z</span><span>z</span><span>z</span></div><div class="ten-3d"><i class="cham-3d"></i><b></b><small></small><span class="viec-cho"></span></div>';
    const n: Nguoi = {
      id: a.id, ngoi, dung, ban: this.ban.get(`${a.desk.x},${a.desk.y}`) ?? null, desk: a.desk, nhan: new CSS2DObject(el), el,
      bongEl: el.querySelector('.bong-3d')!, bbEl: el.querySelector('.bb')!, tenEl: el.querySelector('.ten-3d b')!, phuEl: el.querySelector('.ten-3d small')!, choEl: el.querySelector('.viec-cho')!,
      tt: 'ranh', noi: false, met: false, pha: Math.random() * 20, cur: { than: 0, dau: 0, tT: 0.05, tP: 0.05, zT: 0, zP: 0 },
      walker: newWalker(DOOR), seated: false, bb: '\u0000', noiIdle: false,
    };
    n.tenEl.textContent = a.name;
    n.nhan.center.set(0.5, 1);
    dung.goc.add(n.nhan); n.nhan.position.set(0, 2.05, 0);
    this.nguoi.set(a.id, n);
    return n;
  }

  /** Feed the latest reducer state. Cheap: only touches DOM when a value changed. */
  update(s: OfficeState, now: number) {
    this.s = s;
    for (const id of s.order) { const a = s.agents[id]; if (a && isFree(a)) this.freeSince[id] ??= now; else delete this.freeSince[id]; }
    this.idle = idlePlans(s.agents, s.order, s.messages, now, this.freeSince);
    for (const id of s.order) {
      const a = s.agents[id]; if (!a) continue;
      const n = this.nguoi.get(id) ?? this.themNguoi(a);
      const tt = vpStatus(a.state);
      if (tt !== n.tt) { n.el.classList.remove(`tt-${n.tt}`); n.tt = tt; }
      n.el.classList.add(`tt-${tt}`);
      if (n.el.dataset.state !== a.state) n.el.dataset.state = a.state;
      n.noi = a.state === 'talking'; n.met = a.state === 'error';
      const idle = this.idle[id], arrived = !!idle && n.walker.phase === 'waiting' && n.walker.goalKey === idle.key;
      const b = vpBubble(a, idle, arrived, now); // arrived: small talk only (a done result stays in the panel)
      n.noiIdle = arrived && b.show; n.idleKind = idle && arrived ? idle.kind : undefined;
      n.el.classList.toggle('cai-nhau', n.idleKind === 'fight');
      const key = `${b.show}|${b.dots}|${b.text}`;
      if (key !== n.bb) {
        n.bb = key; n.el.classList.toggle('co-bong', b.show); n.bbEl.textContent = b.text;
        if (b.dots) { const c = document.createElement('span'); c.className = 'cham'; c.append(...[0, 1, 2].map(() => document.createElement('i'))); n.bbEl.append(c); }
      }
      const phu = subtitleFor(a); if (n.phuEl.textContent !== phu) n.phuEl.textContent = phu;
      const cho = a.state === 'working' && a.tool ? (a.tool.ok === false ? 'failed' : a.tool.ok ? 'ok' : 'tool') : '';
      if (n.choEl.textContent !== cho) n.choEl.textContent = cho;
    }
    for (const [id, n] of this.nguoi) if (!s.agents[id]) { this.nhom.remove(n.ngoi.goc, n.dung.goc); n.el.remove(); this.nguoi.delete(id); } // session left
    for (const id in this.freeSince) if (!s.agents[id]) delete this.freeSince[id]; // a swept session coming back with the same ids starts fresh
    const nAgents = s.order.length; this.roomLabel.textContent = nAgents ? `${nAgents} ${nAgents === 1 ? 'person' : 'people'}` : 'empty';
    for (const m of newFlights(s, this.lastMsg)) this.bayPhieu(m.from, m.to);
    if (s.messages.length) this.lastMsg = Math.max(this.lastMsg, ...s.messages.map((m) => m.ts));
  }

  // ---------- Animation (reference capNhatNguoi + tuTheHelpDesk walking pose) ----------
  private capNhatNguoi(n: Nguoi, t: number, dt: number) {
    const h = n.ngoi, s = n.tt, w = t + n.pha, k = Math.min(1, dt * 6);
    const tayNghi = -1.12;
    const muc = { than: 0, dau: 0, tT: tayNghi, tP: tayNghi, zT: 0, zP: 0, nap: NAP_MO };
    const dao = { than: 0, dauX: 0, dauY: 0, dauZ: 0, tT: 0, tP: 0, tZ: 0, nhay: 0 };
    switch (s) {
      case 'dang-lam': muc.dau = 0.14; dao.tT = 0.13 * Math.sin(w * 17); dao.tP = 0.13 * Math.sin(w * 17 + 1.7); dao.dauY = 0.06 * Math.sin(w * 1.1); break;
      case 'xong': muc.tT = muc.tP = -2.9; muc.zT = muc.zP = 0.55; dao.nhay = Math.abs(Math.sin(w * 6)) * 0.22; dao.tZ = 0.15 * Math.sin(w * 6); break;
      case 'loi': muc.dau = 0.18; muc.tP = -2.7; muc.zP = 0.35; dao.dauY = 0.3 * Math.sin(w * 12) * (0.4 + 0.6 * Math.abs(Math.sin(w * 0.8))); break;
      case 'dang-nghi': muc.tP = -2.25; muc.zP = -0.45; dao.dauZ = 0.13 + 0.04 * Math.sin(w * 1.5); dao.dauY = 0.15 * Math.sin(w * 0.7); break;
      case 'dang-nghe': muc.than = 0.08; dao.dauZ = 0.12; dao.nhay = Math.abs(Math.sin(w * 3)) * 0.04; break;
      default: dao.than = 0.012 * Math.sin(w * 2); dao.dauY = 0.3 * Math.sin(w * 0.45) * Math.max(0, Math.sin(w * 0.17)); break;
    }
    if (n.met) { muc.dau += 0.15; dao.tT *= 0.5; dao.tP *= 0.5; }
    const c = n.cur;
    c.than = lerp(c.than, muc.than, k); c.dau = lerp(c.dau, muc.dau, k); c.tT = lerp(c.tT, muc.tT, k); c.tP = lerp(c.tP, muc.tP, k); c.zT = lerp(c.zT, muc.zT, k); c.zP = lerp(c.zP, muc.zP, k);
    h.than.rotation.x = c.than + dao.than;
    h.dau.rotation.set(c.dau + dao.dauX, dao.dauY, dao.dauZ);
    h.tay[0].rotation.x = c.tT + dao.tT; h.tay[1].rotation.x = c.tP + dao.tP;
    h.tay[0].rotation.z = -c.zT; h.tay[1].rotation.z = c.zP + dao.tZ;
    h.goc.position.y = dao.nhay;
    const chop = ((w * 0.27) % 1) < 0.035;
    for (const m of h.mat) m.scale.y = chop ? 0.15 : 1;
    h.mieng.scale.y = n.noi ? 1 + 2.6 * Math.abs(Math.sin(w * 15)) : s === 'xong' ? 3 : 1;
    h.moHoi.visible = n.met; if (n.met) h.moHoi.position.y = 0.5 - ((w * 0.5) % 1) * 0.2;
    this.capNhatBan(n.ban, s, w, dt, muc.nap);
  }
  private capNhatBan(b: Ban | null, s: VpStatus | null, w: number, dt: number, nap = NAP_MO) {
    if (!b) return;
    b.cur = lerp(b.cur, nap, Math.min(1, dt * 6)); b.nap.rotation.x = b.cur;
    b.manHinh.emissiveIntensity = s === 'dang-lam' ? 0.85 + 0.25 * Math.sin(w * 7) : s ? 0.25 : 0.05;
    b.logo.emissiveIntensity = s === 'dang-lam' ? 1.2 : 0.15;
    b.hat.forEach((m, i) => {
      m.visible = s === 'dang-lam'; if (!m.visible) return;
      const p = (w * 0.55 + i / 3) % 1;
      m.position.set(Math.sin(p * 7 + i * 2) * 0.2, 1.12 + p * 0.9, 0.82); m.scale.setScalar(0.11 * (1 - p) + 0.01); m.rotation.set(p * 4, p * 5, 0);
    });
  }
  private tuTheDung(n: Nguoi, t: number, dt: number, di: boolean) {
    const h = n.dung, w = t + n.pha, k = Math.min(1, dt * (di ? 16 : 7));
    let than = 0, dau = 0, dauY = 0, tT = 0.05, tP = 0.05, chanX = 0, nhun = 0, noi = false;
    if (di) {
      n.pha += dt * 1.6 * 3.9; const s = Math.sin(n.pha * 1.0);
      chanX = 0.85 * s; tT = -0.9 * s; tP = 0.9 * s; than = 0.16; nhun = Math.abs(Math.cos(n.pha)) * 0.08;
    } else if (n.idleKind === 'fight') { // ours: playful scuffle, alternating punches with a little hop
      tT = -1.55 + 1.1 * Math.max(0, Math.sin(w * 9)); tP = -1.55 + 1.1 * Math.max(0, Math.sin(w * 9 + Math.PI));
      than = 0.18; dauY = 0.15 * Math.sin(w * 7); nhun = Math.abs(Math.sin(w * 9)) * 0.07; noi = true;
    } else if (n.idleKind === 'pool') { // ours: leaning over the table, cue arm stroking now and then
      than = 0.42; dau = -0.25; tT = -1.25; tP = -1.25 + 0.3 * Math.max(0, Math.sin(w * 2.2)) * (Math.sin(w * 0.5) > 0 ? 1 : 0); noi = n.noiIdle;
    } else if (n.idleKind === 'coffee') { // ours: sipping
      tP = -1.9 + 0.35 * Math.max(0, Math.sin(w * 0.9)); tT = -0.2; dau = -0.08 * Math.max(0, Math.sin(w * 0.9)); noi = n.noiIdle;
    } else if (n.idleKind === 'chat' && !n.noiIdle) { // ours: listening, arms down, nodding
      dau = 0.08 * Math.max(0, Math.sin(w * 2.4)); dauY = 0.05 * Math.sin(w * 0.9); than = 0.012 * Math.sin(w * 2);
    } else { // standing at a colleague's desk: the reference's "le_tan" chatting pose
      tP = -0.7 + 0.35 * Math.sin(w * 3); tT = -0.25 + 0.2 * Math.sin(w * 2.3); dauY = 0.1 * Math.sin(w * 1.7); noi = true; than = 0.012 * Math.sin(w * 2);
    }
    h.goc.position.y = nhun;
    h.chan[0].rotation.x = lerp(h.chan[0].rotation.x, chanX, k); h.chan[1].rotation.x = lerp(h.chan[1].rotation.x, -chanX, k);
    h.than.rotation.x = lerp(h.than.rotation.x, than, k); h.dau.rotation.x = lerp(h.dau.rotation.x, dau, k); h.dau.rotation.y = lerp(h.dau.rotation.y, dauY, k);
    h.tay[0].rotation.x = lerp(h.tay[0].rotation.x, tT, k); h.tay[1].rotation.x = lerp(h.tay[1].rotation.x, tP, k);
    const chop = ((w * 0.27) % 1) < 0.035; for (const m of h.mat) m.scale.y = chop ? 0.15 : 1;
    h.mieng.scale.y = noi ? 1 + 2.4 * Math.abs(Math.sin(w * 13)) : 1;
    h.moHoi.visible = n.met;
  }
  private capNhat(n: Nguoi, t: number, dt: number) {
    const s = this.s!; const a = s.agents[n.id]; if (!a) return;
    n.walker = stepWalker(n.walker, vpGoal(a, s.agents, s.messages, this.idle[n.id]), dt, vpPlan);
    if (n.walker.phase !== 'waiting') n.idleKind = undefined;
    if (n.el.dataset.phase !== n.walker.phase) n.el.dataset.phase = n.walker.phase;
    const seated = n.walker.phase === 'seated';
    if (seated !== n.seated) {
      n.seated = seated; n.ngoi.goc.visible = seated; n.dung.goc.visible = !seated;
      (seated ? n.ngoi.goc : n.dung.goc).add(n.nhan); n.nhan.position.set(0, seated ? 1.95 : 2.05, 0);
    }
    if (seated) { this.capNhatNguoi(n, t, dt); return; }
    const [x, , z] = n.walker.pos; n.dung.goc.position.set(x, 0, z); n.dung.goc.rotation.y = n.walker.heading;
    this.tuTheDung(n, t, dt, n.walker.phase === 'walking');
    this.capNhatBan(n.ban, null, t, dt);
  }

  // ---------- Flying paper between desks on every message (reference bayPhieu) ----------
  private bayPhieu(from: string, to: string) {
    const a = this.nguoi.get(from), b = this.nguoi.get(to);
    if (!a || !b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tu = new THREE.Vector3(); (a.seated ? a.ngoi : a.dung).dau.getWorldPosition(tu);
    const den = new THREE.Vector3(); (b.seated && b.ban ? b.ban.nap : (b.seated ? b.ngoi : b.dung).dau).getWorldPosition(den);
    const m = khoi(this.canh, 0.3, 0.02, 0.38, '#ffffff', tu.x, tu.y, tu.z, false);
    this.bay.push({ m, tu, den, bat: this.dongHo.elapsedTime, lau: 1.1 + tu.distanceTo(den) * 0.02 });
  }
  private capNhatBay(t: number) {
    for (let i = this.bay.length - 1; i >= 0; i--) {
      const b = this.bay[i], p = (t - b.bat) / b.lau;
      if (p >= 1) { this.canh.remove(b.m); this.bay.splice(i, 1); continue; }
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      b.m.position.lerpVectors(b.tu, b.den, e); b.m.position.y += Math.sin(p * Math.PI) * (1.6 + b.tu.distanceTo(b.den) * 0.12);
      b.m.rotation.set(Math.sin(p * Math.PI) * 0.6, p * 7, 0);
    }
  }

  // ---------- Day/night + camera (reference datNgayDem, gocMacDinh, phong, giuTrongBien) ----------
  datNgayDem(laDem: boolean) {
    this.dem = laDem;
    (this.canh.background as THREE.Color).set(laDem ? '#121830' : '#dfe9f1');
    this.troi.intensity = laDem ? 0.5 : 1.6; this.troi.color.set(laDem ? '#8d9cd8' : '#fffaf0'); this.troi.groundColor.set(laDem ? '#2a2440' : '#c8b49a');
    this.nang.intensity = laDem ? 0.45 : 2.2; this.nang.color.set(laDem ? '#a9bcff' : '#fff1dc');
    this.kinhCua.color.set(laDem ? '#1d2c52' : '#bfe3ff'); this.kinhCua.emissive.set(laDem ? '#2a3f6e' : '#cfeaff'); this.kinhCua.emissiveIntensity = laDem ? 0.55 : 0.35;
    for (const d of this.denPhong) d.intensity = laDem ? 9 : 0;
    for (const m of this.chaoDen) m.emissiveIntensity = laDem ? 1.3 : 0;
    this.nutDem.innerHTML = laDem ? SVG.dem : SVG.ngay;
    this.nutDem.title = laDem ? 'Night: click for day' : 'Day: click for night';
  }
  private gocMacDinh() {
    const { x0, x1, z0, z1 } = BIEN;
    const dich = new THREE.Vector3((x0 + x1) / 2, 0.5, (z0 + z1) / 2 + 0.6);
    // ours: fit the whole (wide) floor in the current frame instead of the reference's fixed R * 0.8 + 3
    const asp = (this.vung.clientWidth || 1200) / (this.vung.clientHeight || 800), tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const R = Math.max(((x1 - x0) / 2) / (tanV * asp) * 1.12, ((z1 - z0) / 2) / tanV * 0.95);
    const huong = new THREE.Vector3(0.05, 1.05, 1).normalize();
    return { dich, may: dich.clone().addScaledVector(huong, Math.min(R, this.dk.maxDistance)) };
  }
  private diChuyenGoc(denMay: THREE.Vector3, denDich: THREE.Vector3, lau = 0.6) {
    this.gocVe = { tuMay: this.camera.position.clone(), tuDich: this.dk.target.clone(), denMay, denDich, bat: this.dongHo.elapsedTime, lau };
  }
  private phong(he: number) {
    const d = this.camera.position.clone().sub(this.dk.target);
    const dai = THREE.MathUtils.clamp(d.length() * he, this.dk.minDistance, this.dk.maxDistance);
    this.diChuyenGoc(this.dk.target.clone().add(d.setLength(dai)), this.dk.target.clone(), 0.35);
  }
  private capNhatGoc(t: number) {
    const g = this.gocVe; if (!g) return;
    const p = Math.min(1, (t - g.bat) / g.lau), e = 1 - (1 - p) ** 3;
    this.camera.position.lerpVectors(g.tuMay, g.denMay, e); this.dk.target.lerpVectors(g.tuDich, g.denDich, e);
    if (p >= 1) this.gocVe = null;
  }
  private giuTrongBien() {
    const t = this.dk.target;
    const x = THREE.MathUtils.clamp(t.x, BIEN.x0, BIEN.x1), z = THREE.MathUtils.clamp(t.z, BIEN.z0, BIEN.z1);
    if (x === t.x && z === t.z) return;
    this.camera.position.x += x - t.x; this.camera.position.z += z - t.z; t.x = x; t.z = z;
  }

  private veKhung() {
    const dt = Math.min(0.1, this.dongHo.getDelta()), t = this.dongHo.elapsedTime;
    this.capNhatGoc(t); this.dk.update();
    if (this.s) for (const n of this.nguoi.values()) this.capNhat(n, t, dt);
    this.capNhatBay(t);
    this.nhanR.domElement.classList.toggle('xa', this.camera.position.distanceTo(this.dk.target) > 26);
    this.renderer.render(this.canh, this.camera); this.nhanR.render(this.canh, this.camera);
    if (t - this.lastLayout > 0.12) { this.lastLayout = t; this.tachNhan(); }
  }
  private lastLayout = -1; private lech = new Map<HTMLElement, number>();
  /** Ours (not in the reference): push overlapping names/bubbles apart with our tested resolveOverlaps (walk.ts). */
  private tachNhan() {
    const top = this.vung.getBoundingClientRect().top + 4, boxes: LabelBox[] = [], els = new Map<string, HTMLElement>();
    for (const n of this.nguoi.values()) {
      for (const [el, fixed] of [[n.el.querySelector<HTMLElement>('.ten-3d')!, true], [n.bongEl, false]] as const) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const id = `${n.id}:${fixed ? 'n' : 'b'}`; els.set(id, el);
        boxes.push({ id, x: r.left, y: r.top - (this.lech.get(el) ?? 0), w: r.width, h: r.height, fixed });
      }
    }
    const dy = resolveOverlaps(boxes, 4, 40, top);
    for (const [id, el] of els) {
      const d = Math.round(dy[id] ?? 0); if (d === (this.lech.get(el) ?? 0)) continue;
      this.lech.set(el, d); el.style.transform = d ? `translateY(${d}px)` : '';
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect(); this.khung.removeEventListener('click', this.onClick); this.dk.dispose();
    for (const b of this.bay) this.canh.remove(b.m);
    this.canh.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
    for (const r of this.rieng) r.dispose();
    this.kinhCua.dispose(); this.renderer.dispose();
    this.khung.innerHTML = ''; this.khung.classList.remove('vp-ref');

  }
}

