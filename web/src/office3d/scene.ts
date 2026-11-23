// 3D office scene, ported from VanphongAI (Phuc) van_phong_3d.js. See ./NOTICE.
// Builders (floor, walls, windows, plants, desks, glass room, lamp), the per-state pose animation, the flying paper,
// day/night and the camera buttons are copied from the reference with small edits. What is ours: the state now comes
// from our reducer (update()), people walk with our walker (../walk.ts), and the server room, store-room door, reception,
// lobby, help-desk wandering and all server/API calls are gone. Identifiers were translated to English (reference names are noted in
// comments where a builder maps to one). Also ours: defaultView's camera fit, the idle poses, freeSince and the amenity wiring,
// the town around the building (./town3d.ts), throwing an agent to the crocodiles, and the chosen names/avatars (../town/looks.ts).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AgentUI, DeckState } from '../reducer';
import { allDesks } from '../layout';
import { newWalker, resolveOverlaps, stepWalker, type LabelBox, type Walker } from '../walk';
import { walkerSpeedFor } from '../officeRunSpeed';
import { block, mix, material, glowMaterial, buildPerson, setShadows, type Body } from './characters';
import { FLOOR, DOOR, ROOM, ROOM_COLOR, idlePlans, isFree, lookFor, newFlights, subtitleFor, officeBubble, officeChair, officeGoal, officePlan, officeStatus, type IdlePlan, type OfficeStatus } from './adapter';
import { HeartFX } from './hearts';
import { buildGameRoom, buildPantry } from './amenities';
import { LABELS_EVENT, applyLabelVisibility, isLabelOn } from '../officeLabels';
import { TOWN_BOUNDS, liveEye, TownLayer } from './town3d';
import { fromWorld, toWorld } from '../town/map';
import { GRASP_LIFT, graspWorldFromCarrier, walkerHeldByLayoff } from '../town/sim';
import { agentKey, currentLook, currentName } from '../town/looks';
import {
  cameraFromEye, clampLook, EYE_PUSH, enterPovView, exitPovView, isFiniteSnap, lookDelta,
  OVERVIEW_FOV, OVERVIEW_NEAR, POV_FOV, POV_NEAR, subjectGone, type CamSnap, type Eye, type PovView,
} from '../povCam';

export interface MenuTarget { kind: 'agent' | 'ent'; id: string; x: number; y: number }
export const THROW_FLY = 0.9, RESPAWN_MS = 20_000;

const DESK_TOP = 0.72;   // desk top
const LID_OPEN = 0.25, LID_CLOSED = -1.5; // laptop lid angles
const lerp = THREE.MathUtils.lerp;
const SVG = {
  night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.3A8 8 0 0 1 8.7 4a8 8 0 1 0 11.3 11.3Z"/></svg><span>Night</span>',
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Day</span>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 12 7v3L7.5 6 12 2z"/></svg>',
  exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7V4h11v16H9v-3M4 12h12M8 8l-4 4 4 4"/></svg><span>Thoát</span>',
};
const HINT = 'Drag to rotate · scroll to zoom · right-drag to pan · click a name: đặt tên, avatar, nhìn từ nhân vật, ném cho cá sấu';
const HINT_POV = 'Drag to look around · Esc or Thoát restores the previous view';
/** Software rasterisers (SwiftShader/llvmpipe) can't afford shadows + MSAA. */
function softwareGL() {
  try { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info');
    return /swiftshader|llvmpipe|software/i.test(e ? String(c!.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''); } catch { return false; }
}

interface DeskRig { g: THREE.Group; lid: THREE.Group; screen: THREE.MeshLambertMaterial; logo: THREE.MeshLambertMaterial; specks: THREE.Mesh[]; cur: number }
interface Pose { torso: number; head: number; armL: number; armR: number; rollL: number; rollR: number }
interface Person {
  id: string; sitBody: Body; standBody: Body; rig: DeskRig | null; desk: { x: number; y: number }; label: CSS2DObject; el: HTMLDivElement;
  bubbleEl: HTMLDivElement; bbEl: HTMLSpanElement; nameEl: HTMLElement; subEl: HTMLElement; waitEl: HTMLElement;
  status: OfficeStatus; talking: boolean; tired: boolean; cycle: number; cur: Pose; walker: Walker; seated: boolean; bb: string;
  /** ours: what the agent does while free (set once it has arrived), and whether its small-talk line is showing */
  idleKind?: IdlePlan['kind']; idleTalking: boolean;
  /** ours: chosen preset id ('' = role default), and until when the agent is gone (thrown to the crocodiles) */
  lookId: string; goneUntil?: number;
  /** ours: Layoff is carrying this office agent; walker must not run. */
  held?: boolean;
}
interface Throw { m: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; start: number }
interface Flight { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; start: number; dur: number }

export class OfficeScene {
  private renderer: THREE.WebGLRenderer; private labelRenderer = new CSS2DRenderer(); private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400); private controls: OrbitControls; private clock = new THREE.Clock();
  private sky = new THREE.HemisphereLight('#fffaf0', '#c8b49a', 1.6); private sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  private windowGlass = new THREE.MeshLambertMaterial({ color: '#bfe3ff', emissive: '#cfeaff', emissiveIntensity: 0.35 });
  private owned: { dispose(): void }[] = []; private roomLights: THREE.PointLight[] = []; private lampShades: THREE.MeshLambertMaterial[] = [];
  private group = new THREE.Group(); private rigs = new Map<string, DeskRig>(); private people = new Map<string, Person>(); private flights: Flight[] = [];
  private s: DeckState | null = null; private idle: Record<string, IdlePlan> = {}; private freeSince: Record<string, number> = {}; private lastMsg = 0; private night = false; private camAnim: null | { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; start: number; dur: number } = null;
  private town!: TownLayer; private hearts!: HeartFX; private heartCd = 0; private throws: Throw[] = []; private farFrom = 26;
  private ro: ResizeObserver; private viewport: HTMLDivElement; private nightBtn: HTMLButtonElement; private soft = softwareGL();
  private povView: PovView = { pov: null, saved: null }; private dragging = false; private hintEl!: HTMLParagraphElement; private paused = false;

  constructor(private host: HTMLElement, private store?: Pick<Storage, 'getItem' | 'setItem'>, private onMenu?: (m: MenuTarget) => void) {
    setShadows(!this.soft);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.soft });
    host.classList.add('office3d-ref');
    host.innerHTML = `<div class="office3d-scene"></div>
      <div class="office3d-tools">
        <button type="button" class="btn-3d" data-3d="day-night" data-testid="office3d-daynight"></button>
        <button type="button" class="btn-3d" data-3d="zoom-in" title="Zoom in" aria-label="Zoom in">${SVG.zoomIn}</button>
        <button type="button" class="btn-3d" data-3d="zoom-out" title="Zoom out" aria-label="Zoom out">${SVG.zoomOut}</button>
        <button type="button" class="btn-3d" data-3d="reset" title="Reset view" aria-label="Reset view">${SVG.reset}</button>
        <button type="button" class="btn-3d" data-3d="exit-pov" data-testid="office3d-pov-exit" title="Thoát nhìn từ nhân vật" aria-label="Thoát nhìn từ nhân vật">${SVG.exit}</button>
      </div>
      <p class="office3d-hint">${HINT}</p>`;
    this.viewport = host.querySelector('.office3d-scene')!;
    this.nightBtn = host.querySelector('[data-3d="day-night"]')!;
    this.hintEl = host.querySelector('.office3d-hint')!;
    const r = this.renderer;
    r.setPixelRatio(this.soft ? 0.85 : Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = !this.soft; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.viewport.append(r.domElement);
    this.labelRenderer.domElement.className = 'office3d-labels';
    this.viewport.append(this.labelRenderer.domElement);
    this.scene.background = new THREE.Color('#dfe9f1');
    this.scene.add(this.sky);
    this.sun.castShadow = !this.soft; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 3.5, maxDistance: 95, minPolarAngle: 0.15, maxPolarAngle: 1.32, rotateSpeed: 0.7 });
    this.controls.addEventListener('change', () => { if (!this.povView.pov) this.clampToBounds(); });
    this.controls.addEventListener('start', () => { if (!this.povView.pov) this.camAnim = null; });
    this.scene.add(this.group);
    this.standBody();
    const g = this.defaultView(); this.camera.position.copy(g.pos); this.controls.target.copy(g.target); this.controls.update();
    const saved = store?.getItem('deck.night');
    const hour = new Date().getHours();
    this.setNight(saved ? saved === '1' : hour < 6 || hour >= 18);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.viewport); this.resize();
    host.addEventListener('click', this.onClick); host.addEventListener('contextmenu', this.onMenuEv);
    r.domElement.addEventListener('pointerdown', this.onPtrDown);
    r.domElement.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', this.onPtrMove);
    window.addEventListener('pointerup', this.onPtrUp);
    window.addEventListener('pointercancel', this.onPtrUp);
    r.setAnimationLoop(() => this.frame());
    this.writeCam();
    try {
      if (this.store?.getItem('deck.debug') === '1') {
        (window as unknown as { __deckPov?: { enter: (k: MenuTarget['kind'], id: string) => boolean; exit: () => boolean; snap: () => CamSnap; subject: () => PovView['pov'] } }).__deckPov = {
          enter: (kind, id) => this.enterPov(kind, id), exit: () => this.exitPov(), snap: () => this.camSnap(), subject: () => this.povView.pov,
        };
      }
    } catch { /* private mode */ }
  }
  private onWheel = (e: WheelEvent) => { if (this.povView.pov) { e.preventDefault(); e.stopImmediatePropagation(); } };

  /** ours: click / right-click on a name tag or bubble opens the town menu (name & avatar, throw to the crocodiles). */
  private onMenuEv = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.name-3d, .bubble-3d')?.closest<HTMLElement>('[data-nv], [data-ent]'); if (!t || !this.onMenu) return;
    e.preventDefault(); e.stopPropagation();
    this.onMenu(t.dataset.nv ? { kind: 'agent', id: t.dataset.nv, x: e.clientX, y: e.clientY } : { kind: 'ent', id: t.dataset.ent!, x: e.clientX, y: e.clientY });
  };
  private onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.name-3d, .bubble-3d')) { this.onMenuEv(e); return; }
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-3d]'); if (!btn) return;
    const action = btn.dataset['3d'];
    if (action === 'day-night') { this.setNight(!this.night); try { this.store?.setItem('deck.night', this.night ? '1' : '0'); } catch { /* private mode */ } }
    else if (action === 'exit-pov') this.exitPov();
    else if (this.povView.pov) return;
    else if (action === 'zoom-in') this.zoom(0.7);
    else if (action === 'zoom-out') this.zoom(1.4);
    else if (action === 'reset') { const g = this.defaultView(); this.moveView(g.pos, g.target); }
  };
  private onPtrDown = (e: PointerEvent) => {
    if (!this.povView.pov || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.btn-3d, .name-3d, .bubble-3d, [data-3d]')) return;
    this.dragging = true; this.host.classList.add('is-dragging');
  };
  private onPtrMove = (e: PointerEvent) => {
    const p = this.povView.pov; if (!this.dragging || !p) return;
    const d = lookDelta(e.movementX, e.movementY); p.look = clampLook(p.look, d.dyaw, d.dpitch);
  };
  private onPtrUp = () => { this.dragging = false; this.host.classList.remove('is-dragging'); };

  isPov() { return !!this.povView.pov; }
  /** ours: stop/restart the render loop while the view is hidden (History tab); scene, sim state and WebGL context stay alive.
   *  On resume the clock restarts from now without adding the paused time to elapsedTime (getDelta() would), so camera/flight/pond animations keyed on t don't jump. */
  setPaused(p: boolean) { if (p === this.paused) return; this.paused = p; if (!p) this.clock.oldTime = performance.now(); this.renderer.setAnimationLoop(p ? null : () => this.frame()); }
  canEnterPov(kind: MenuTarget['kind'], id: string) {
    if (kind === 'agent') {
      const n = this.people.get(id);
      return !!n && !!this.s?.agents[id] && !(n.goneUntil && Date.now() < n.goneUntil);
    }
    return this.town.hasPovEnt(id);
  }
  enterPov(kind: MenuTarget['kind'], id: string) {
    if (!this.canEnterPov(kind, id)) return false;
    const prev = this.povView.pov;
    if (prev) this.showSubject(prev.kind, prev.id);
    this.povView = enterPovView(this.povView, { kind, id }, this.camSnap());
    this.controls.enabled = false; this.camAnim = null;
    this.camera.fov = POV_FOV; this.camera.near = POV_NEAR; this.camera.updateProjectionMatrix();
    this.setPovUi(true);
    if (!this.applyPov()) { this.exitPov(); return false; }
    return true;
  }
  exitPov() {
    const { view, restore } = exitPovView(this.povView);
    const was = this.povView.pov;
    this.dragging = false; this.host.classList.remove('is-dragging');
    if (was) this.showSubject(was.kind, was.id);
    this.povView = view; this.camAnim = null;
    this.setPovUi(false);
    if (restore && isFiniteSnap(restore)) this.setCam(restore); else this.setCam(this.camSnap());
    this.controls.update(); this.controls.enabled = true;
    return !!restore;
  }
  private camSnap(): CamSnap {
    const p = this.camera.position, t = this.controls.target;
    return { px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z, fov: this.camera.fov, near: this.camera.near };
  }
  private setCam(s: CamSnap) {
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(s.px, s.py, s.pz); this.controls.target.set(s.tx, s.ty, s.tz);
    this.camera.fov = Number.isFinite(s.fov) ? s.fov : OVERVIEW_FOV;
    this.camera.near = Number.isFinite(s.near) ? s.near : OVERVIEW_NEAR;
    this.camera.updateProjectionMatrix();
    this.writeCam();
  }
  private writeCam() {
    const s = this.camSnap();
    this.host.dataset.cam = [s.px, s.py, s.pz, s.tx, s.ty, s.tz, s.fov].map((n) => n.toFixed(3)).join(',');
  }
  private setPovUi(on: boolean) {
    this.host.classList.toggle('is-pov', on);
    this.host.dataset.pov = on && this.povView.pov ? `${this.povView.pov.kind}:${this.povView.pov.id}` : '';
    this.hintEl.textContent = on ? HINT_POV : HINT;
    this.controls.enableRotate = this.controls.enablePan = this.controls.enableZoom = !on;
  }
  private personEye(h: Body): Eye | undefined { return liveEye(h.head, h.eyes, EYE_PUSH); }
  private readEye(): Eye | undefined {
    const p = this.povView.pov; if (!p) return;
    if (p.kind === 'agent') {
      const n = this.people.get(p.id);
      if (subjectGone('agent', { agentPresent: !!n && !!this.s?.agents[p.id], gone: !!(n?.goneUntil && Date.now() < n.goneUntil) })) return;
      return n ? this.personEye(n.seated ? n.sitBody : n.standBody) : undefined;
    }
    const e = this.town.ent(p.id);
    if (subjectGone('ent', { entPresent: !!e, entKind: e?.kind, entAct: e?.act })) return;
    return this.town.eyeOf(p.id);
  }
  private hideSubject(kind: MenuTarget['kind'], id: string) {
    if (kind === 'agent') {
      const n = this.people.get(id); if (!n) return;
      n.sitBody.root.visible = false; n.standBody.root.visible = false; n.el.style.visibility = 'hidden';
      return;
    }
    this.town.hideFig(id, true);
  }
  private showSubject(kind: MenuTarget['kind'], id: string) {
    if (kind === 'agent') {
      const n = this.people.get(id); if (!n) return;
      n.sitBody.root.visible = n.seated; n.standBody.root.visible = !n.seated; n.el.style.visibility = '';
      return;
    }
    this.town.hideFig(id, false);
  }
  private applyPov() {
    const p = this.povView.pov; if (!p) return false;
    const eye = this.readEye(), aim = eye && cameraFromEye(eye, p.look);
    if (!aim || !Number.isFinite(aim.px + aim.py + aim.pz + aim.tx + aim.ty + aim.tz)) return false;
    this.hideSubject(p.kind, p.id);
    const dy = aim.ty - aim.py;
    this.camera.up.set(0, Math.abs(dy) > 0.95 ? 0 : 1, Math.abs(dy) > 0.95 ? (dy > 0 ? -1 : 1) : 0);
    this.camera.position.set(aim.px, aim.py, aim.pz);
    this.camera.lookAt(aim.tx, aim.ty, aim.tz);
    this.controls.target.set(aim.tx, aim.ty, aim.tz);
    this.writeCam();
    return true;
  }

  private resize() {
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  private own<T extends { dispose(): void }>(m: T) { this.owned.push(m); return m; }

  // ---------- Static office (reference anhSan, dungNen, cuaSo, cayCanh, dungPhong, buildDesk → floorTexture, buildShell, addWindow, plant, buildRoom, buildDesk) ----------
  private floorTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!; const colors = ['#e8d6bd', '#e2ceb2', '#ecdcc6', '#ddc8ab'];
    for (let row = 0; row < 8; row++) {
      let x = -((row * 37) % 64), i = row;
      while (x < 256) {
        const len = 64 + ((row * 13 + i * 7) % 3) * 32;
        g.fillStyle = colors[i % 4]; g.fillRect(x, row * 32, len, 32);
        g.fillStyle = 'rgba(120, 90, 60, .2)'; g.fillRect(x, row * 32, 2, 32);
        x += len; i++;
      }
      g.fillStyle = 'rgba(120, 90, 60, .22)'; g.fillRect(0, row * 32 + 31, 256, 1);
    }
    const t = this.own(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  private plant(parent: THREE.Object3D, x: number, z: number, size = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(size); parent.add(g);
    block(g, 0.36, 0.36, 0.36, '#c98b5e', 0, 0.18, 0);
    block(g, 0.4, 0.06, 0.4, '#b5764c', 0, 0.37, 0);
    block(g, 0.5, 0.4, 0.5, '#4caf6a', 0, 0.62, 0);
    block(g, 0.36, 0.34, 0.36, '#5cc27a', 0.04, 0.95, -0.02).rotation.y = 0.4;
    block(g, 0.22, 0.26, 0.22, '#6fd08b', -0.03, 1.2, 0.02).rotation.y = 0.8;
  }
  private addWindow(x: number, z: number, rot: number) {
    const g = new THREE.Group(); g.position.set(x, 1.55, z); g.rotation.y = rot; this.group.add(g);
    block(g, 1.7, 1.2, 0.02, this.windowGlass, 0, 0, 0.01, false);
    const k = '#ffffff';
    block(g, 1.84, 0.07, 0.05, k, 0, 0.635, 0.02, false); block(g, 1.84, 0.07, 0.05, k, 0, -0.635, 0.02, false);
    for (const b of [-1, 1]) block(g, 0.07, 1.27, 0.05, k, b * 0.885, 0, 0.02, false);
    block(g, 0.05, 1.2, 0.04, k, 0, 0, 0.02, false); block(g, 1.94, 0.05, 0.16, k, 0, -0.68, 0.07, false);
  }
  /** Entrance door frame in the back wall where agents arrive (geometry from the reference's store-room door, no click action). */
  private addDoor(x: number, z: number) {
    const g = new THREE.Group(); g.position.set(x, 0, z + 0.006); this.group.add(g);
    const wood = '#8a6f5a';
    block(g, 1.2, 2.15, 0.012, '#1d1a22', 0, 1.075, 0.006, false);
    for (const b of [-1, 1]) block(g, 0.12, 2.3, 0.14, wood, b * 0.66, 1.15, 0.07);
    block(g, 1.44, 0.14, 0.14, wood, 0, 2.3, 0.07);
    block(g, 1.5, 0.04, 0.3, '#6b5544', 0, 0.02, 0.15, false);
    const leaf = new THREE.Group(); leaf.position.set(-0.6, 0, 0.05); leaf.rotation.y = -1.35; g.add(leaf); // held open
    block(leaf, 1.2, 2.15, 0.06, '#a77b54', 0.6, 1.075, 0);
    for (const y of [0.55, 1.5]) block(leaf, 0.86, 0.66, 0.02, '#7a5c42', 0.6, y, 0.035, false);
    block(leaf, 0.08, 0.08, 0.08, '#f2c14e', 1.08, 1.05, 0.06, false);
  }
  private buildShell(floorMat: THREE.MeshLambertMaterial, tex: THREE.Texture) {
    const { x0, x1, z0, z1 } = FLOOR, group = this.group;
    const r = x1 - x0, s = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    block(group, r + 0.4, 0.3, s + 0.4, '#cdb89c', cx, -0.15, cz, false);
    tex.repeat.set(r / 4, s / 4);
    const floor = new THREE.Mesh(this.own(new THREE.PlaneGeometry(r, s)), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.002, cz); floor.receiveShadow = !this.soft; group.add(floor);
    const T = '#f4ede3', WALL_H = 2.7;
    // Four walls: keep functional door on the back (z0); glass entrance on the road-facing front (z1).
    block(group, r + 0.4, WALL_H, 0.2, T, cx, WALL_H / 2, z0 - 0.1); // back
    block(group, 0.2, WALL_H, s + 0.2, T, x0 - 0.1, WALL_H / 2, cz + 0.1); // left
    block(group, 0.2, WALL_H, s + 0.2, T, x1 + 0.1, WALL_H / 2, cz + 0.1); // right (was missing)
    // Front facade toward the road: clear aluminium-framed glass curtain wall with a framed main door (visual; walkers still use DOOR at back).
    const frontDoor = 2.4, fz = z1 + 0.1, AL = '#9aa4ae', DF = '#37474f';
    const glass = material('#e3f4fb', { transparent: true, opacity: 0.16, depthWrite: false });
    for (const [a, b] of [[x0 - 0.2, cx - frontDoor / 2 - 0.12], [cx + frontDoor / 2 + 0.12, x1 + 0.2]]) {
      const w = b - a, n = Math.max(1, Math.round(w / 3.2)), pw = w / n; // panes ~2× wider (was /1.6)
      block(group, w, WALL_H - 0.2, 0.03, glass, (a + b) / 2, (WALL_H - 0.2) / 2 + 0.12, fz, false);
      for (let i = 0; i <= n; i++) block(group, 0.07, WALL_H, 0.12, AL, a + i * pw, WALL_H / 2, fz, false); // mullions
      for (const y of [0.06, WALL_H - 0.06]) block(group, w, 0.07, 0.12, AL, (a + b) / 2, y, fz, false); // sill + head only (no mid rail)
    }
    // main door: thick dark frame, double glass leaves with handles, transom above
    const dh = WALL_H - 0.5;
    for (const s of [-1, 1]) block(group, 0.18, WALL_H, 0.2, DF, cx + s * (frontDoor / 2 + 0.03), WALL_H / 2, fz); // jambs
    block(group, frontDoor + 0.24, 0.16, 0.2, DF, cx, dh + 0.08, fz, false); // head
    block(group, frontDoor + 0.24, 0.08, 0.2, DF, cx, WALL_H - 0.04, fz, false);
    block(group, frontDoor - 0.1, WALL_H - dh - 0.24, 0.03, glass, cx, (dh + WALL_H) / 2 + 0.02, fz, false); // transom glass
    for (const s of [-1, 1]) {
      const lx = cx + s * frontDoor / 4;
      block(group, frontDoor / 2 - 0.06, dh - 0.04, 0.03, glass, lx, dh / 2, fz + 0.02, false);
      for (const y of [0.04, dh - 0.04]) block(group, frontDoor / 2 - 0.04, 0.07, 0.07, DF, lx, y, fz + 0.02, false);
      block(group, 0.06, dh, 0.07, DF, cx + s * 0.03, dh / 2, fz + 0.02, false); // meeting stiles
      block(group, 0.04, 0.6, 0.06, '#d7dde2', cx + s * 0.16, 1.05, fz + 0.1, false); // pull handles
    }
    block(group, frontDoor + 0.6, 0.03, 0.9, '#5a5f66', cx, 0.015, fz + 0.5, false); // entrance step
    // "Crossian" company decal on the glass (blue lettering, rest of the pane stays clear)
    {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d')!;
      g.fillStyle = '#1e6bff'; g.font = 'bold 200px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Crossian', 512, 136);
      const t = this.own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const decalMat = this.own(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const decal = new THREE.Mesh(this.own(new THREE.PlaneGeometry(5.6, 1.4)), decalMat);
      decal.position.set(cx - frontDoor / 2 - 3.6, 1.7, fz + 0.04); group.add(decal);
    }
    // Caps / skirting
    block(group, r + 0.44, 0.06, 0.26, '#e2d5c4', cx, WALL_H + 0.03, z0 - 0.1, false);
    block(group, r + 0.44, 0.06, 0.26, '#e2d5c4', cx, WALL_H + 0.03, z1 + 0.1, false);
    block(group, 0.26, 0.06, s + 0.24, '#e2d5c4', x0 - 0.1, WALL_H + 0.03, cz + 0.1, false);
    block(group, 0.26, 0.06, s + 0.24, '#e2d5c4', x1 + 0.1, WALL_H + 0.03, cz + 0.1, false);
    block(group, r, 0.12, 0.03, '#d9cab6', cx, 0.06, z0 + 0.015, false);
    block(group, r, 0.12, 0.03, '#d9cab6', cx, 0.06, z1 - 0.015, false);
    block(group, 0.03, 0.12, s, '#d9cab6', x0 + 0.015, 0.06, cz, false);
    block(group, 0.03, 0.12, s, '#d9cab6', x1 - 0.015, 0.06, cz, false);
    block(group, 1.8, 0.02, 0.7, '#8a6f5a', DOOR[0], 0.01, z0 + 0.45, false); // doormat at character door
    block(group, 2.2, 0.02, 0.8, '#8a6f5a', cx, 0.01, z1 - 0.5, false); // mat at glass entrance
    for (const x of [-10.6, -4.6, 4.6, 10.6]) this.addWindow(x, z0 + 0.005, 0);
    this.addDoor(DOOR[0], z0);
    for (let i = 0; i < 4; i++) this.addWindow(x0 + 0.005, z0 + (i + 0.5) * s / 4, Math.PI / 2);
    for (let i = 0; i < 4; i++) this.addWindow(x1 - 0.005, z0 + (i + 0.5) * s / 4, -Math.PI / 2); // right-wall windows
    // Light interior dressing: hanging lights, a board, extra plants (don't move desks / IT Ops).
    for (const [lx, lz] of [[-6, 0], [0, 2], [6, -1], [-3, -3], [4, 3]]) {
      block(group, 0.08, 0.4, 0.08, '#5d5f6b', lx, WALL_H - 0.35, lz, false);
      block(group, 0.55, 0.08, 0.55, '#fff4d6', lx, WALL_H - 0.55, lz, false);
    }
    block(group, 1.6, 0.9, 0.04, '#eceff1', x0 + 1.2, 1.6, z0 + 0.15, false); // notice board on back wall
    block(group, 1.4, 0.7, 0.02, '#bbdefb', x0 + 1.2, 1.6, z0 + 0.18, false);
    this.plant(group, DOOR[0] - 1.4, z0 + 0.45, 1.1); this.plant(group, DOOR[0] + 1.4, z0 + 0.45, 1.1);
    this.plant(group, x0 + 0.6, z1 - 0.6); this.plant(group, x1 - 0.6, z1 - 0.6);
    this.plant(group, x1 - 0.7, z0 + 1.2, 0.9); this.plant(group, cx + 1.5, z1 - 0.7, 0.85);
    const ctx = { group, soft: this.soft, own: <T extends { dispose(): void }>(m: T) => this.own(m), lights: this.roomLights, shades: this.lampShades,
      plant: (parent: THREE.Object3D, x: number, z: number, size?: number) => this.plant(parent, x, z, size) };
    buildPantry(ctx); buildGameRoom(ctx);
    this.town = new TownLayer(ctx);
    try { window.addEventListener(LABELS_EVENT, this.onLabelsChanged); } catch { /* */ }
    this.hearts = new HeartFX(this.group);
  }
  private buildDesk(parent: THREE.Object3D, x: number, z: number, roomColor: string, i: number): DeskRig {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
    const chair = mix(roomColor, '#2a2833', 0.45);
    block(g, 0.52, 0.08, 0.5, chair, 0, 0.45, 0.08);
    block(g, 0.52, 0.56, 0.08, chair, 0, 0.78, -0.22);
    block(g, 0.06, 0.38, 0.06, '#5d5f6b', 0, 0.22, 0.05);
    block(g, 0.56, 0.04, 0.08, '#4a4c57', 0, 0.03, 0.05, false);
    block(g, 0.08, 0.04, 0.56, '#4a4c57', 0, 0.03, 0.05, false);
    block(g, 1.5, 0.06, 0.72, '#d9b68f', 0, DESK_TOP - 0.03, 0.62);
    for (const b of [-1, 1]) block(g, 0.05, DESK_TOP - 0.06, 0.66, '#efe8dd', b * 0.7, (DESK_TOP - 0.06) / 2, 0.62);
    block(g, 1.36, 0.4, 0.03, '#efe8dd', 0, 0.42, 0.95);
    block(g, 0.52, 0.025, 0.34, '#d8dce5', 0, DESK_TOP + 0.012, 0.6);
    const lid = new THREE.Group(); lid.position.set(0, DESK_TOP + 0.025, 0.77); lid.rotation.x = LID_OPEN; g.add(lid);
    block(lid, 0.52, 0.34, 0.022, '#d8dce5', 0, 0.17, 0);
    const screen = this.own(new THREE.MeshLambertMaterial({ color: '#1c2030', emissive: roomColor, emissiveIntensity: 0.2 }));
    block(lid, 0.46, 0.28, 0.004, screen, 0, 0.17, -0.013, false);
    const logo = this.own(new THREE.MeshLambertMaterial({ color: '#aab1c2', emissive: roomColor, emissiveIntensity: 0.1 }));
    block(lid, 0.08, 0.08, 0.004, logo, 0, 0.18, 0.013, false);
    block(g, 0.09, 0.11, 0.09, '#ffffff', 0.5, DESK_TOP + 0.055, 0.5);
    if (i % 2 === 0) block(g, 0.22, 0.04, 0.3, '#f7f4ee', -0.5, DESK_TOP + 0.02, 0.62).rotation.y = 0.2;
    else { block(g, 0.1, 0.1, 0.1, '#c98b5e', -0.55, DESK_TOP + 0.05, 0.72); block(g, 0.16, 0.14, 0.16, '#58b26a', -0.55, DESK_TOP + 0.17, 0.72); }
    const specks = [0, 1, 2].map(() => { const m = block(g, 0.06, 0.06, 0.06, glowMaterial(mix(roomColor, '#ffffff', 0.25)), 0, 1.2, 0.8, false); m.visible = false; return m; });
    return { g, lid, screen, logo, specks, cur: LID_OPEN };
  }
  /** One glass room around our desk grid (reference dungPhong), door gap in the back wall facing the entrance. */
  private buildRoom() {
    const color = ROOM_COLOR, { x0, x1, z0, z1, door } = ROOM;
    const g = new THREE.Group(); const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; g.position.set(cx, 0, cz); this.group.add(g);
    const width = x1 - x0, depth = z1 - z0, nr = width / 2, ns = depth / 2;
    block(g, width, 0.03, depth, mix(color, '#ffffff', 0.8), 0, 0.015, 0, false);
    const glass = material(mix(color, '#ffffff', 0.5), { transparent: true, opacity: 0.25, depthWrite: false });
    const trim = mix(color, '#3a3346', 0.25);
    const WALL_H = 1.05;
    const wall = (w: number, d: number, x: number, z: number) => { block(g, w, WALL_H, d, glass, x, WALL_H / 2 + 0.03, z, false); block(g, w, 0.06, d + 0.01, trim, x, WALL_H + 0.06, z, false); };
    wall(width, 0.05, 0, ns); wall(0.05, depth, -nr, 0); wall(0.05, depth, nr, 0);
    const wBack = (width - door) / 2;
    wall(wBack, 0.05, -nr + wBack / 2, -ns); wall(wBack, 0.05, nr - wBack / 2, -ns);
    for (const [px, pz] of [[-nr, -ns], [nr, -ns], [-nr, ns], [nr, ns], [-door / 2, -ns], [door / 2, -ns]]) block(g, 0.09, WALL_H + 0.12, 0.09, trim, px, (WALL_H + 0.12) / 2, pz);
    const lx = nr - 0.4, lz = -ns + 0.4;
    block(g, 0.3, 0.04, 0.3, '#5d5f6b', lx, 0.02, lz); block(g, 0.05, 1.6, 0.05, '#5d5f6b', lx, 0.8, lz);
    const shade = this.own(new THREE.MeshLambertMaterial({ color: '#fff4d6', emissive: '#ffd27a', emissiveIntensity: 0 }));
    block(g, 0.42, 0.26, 0.42, shade, lx, 1.72, lz); this.lampShades.push(shade);
    const lamp = new THREE.PointLight('#ffd9a0', 0, Math.max(width, depth) * 1.3, 1.6); lamp.position.set(0, 2.4, 0); g.add(lamp); this.roomLights.push(lamp);
    this.plant(g, -nr + 0.4, -ns + 0.4, 0.8);
    allDesks().forEach((d, i) => { const [x, , z] = officeChair(d); this.rigs.set(`${d.x},${d.y}`, this.buildDesk(this.group, x, z, color, i)); });
    const div = document.createElement('div'); div.className = 'room-label-3d'; div.style.setProperty('--tint', color); div.dataset.label = 'workroom';
    div.append(document.createElement('i'), document.createTextNode('Work room'), document.createElement('small'));
    applyLabelVisibility(div, isLabelOn('workroom'));
    const label = new CSS2DObject(div); label.center.set(0, 1); label.position.set(-nr + 0.1, WALL_H + 0.2, ns); g.add(label);
    this.roomLabel = div.querySelector('small')!;
    this.roomLabelEl = div;
  }
  private roomLabel!: HTMLElement;
  private roomLabelEl!: HTMLElement;
  private standBody() {
    const tex = this.floorTexture();
    const floorMat = this.own(new THREE.MeshLambertMaterial({ map: tex }));
    this.buildShell(floorMat, tex);
    this.buildRoom();
    const { x0, x1, z0, z1 } = TOWN_BOUNDS, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; // ours: light the whole town
    const R = Math.hypot(x1 - x0, z1 - z0) / 2 + 1;
    this.sun.position.set(cx + R * 0.55, R * 1.3 + 6, cz + R * 0.8); this.sun.target.position.set(cx, 0, cz);
    Object.assign(this.sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 5 + 20 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  // ---------- People: our agents, reference look + labels ----------
  private addPerson(a: AgentUI): Person {
    const look = lookFor(a);
    const sitBody = buildPerson(look, true), standBody = buildPerson(look, false), lookId = currentLook(agentKey(a)) ?? '';
    const chair = officeChair(a.desk); sitBody.root.position.set(chair[0], 0, chair[2]); sitBody.root.visible = false;
    this.group.add(sitBody.root, standBody.root);
    const el = document.createElement('div');
    el.className = 'person-3d'; el.dataset.nv = a.id; el.dataset.testid = `office3d-agent-${a.id}`; el.style.setProperty('--tint', look.accent ?? ROOM_COLOR);
    // Static markup only; every dynamic string goes through textContent.
    el.innerHTML = '<div class="bubble-3d"><span class="bb"></span></div><div class="zzz-3d" aria-hidden="true"><span>Z</span><span>z</span><span>z</span></div><div class="name-3d"><i class="dot-3d"></i><b></b><small></small><span class="wait-3d"></span></div>';
    const n: Person = {
      id: a.id, sitBody, standBody, rig: this.rigs.get(`${a.desk.x},${a.desk.y}`) ?? null, desk: a.desk, label: new CSS2DObject(el), el,
      bubbleEl: el.querySelector('.bubble-3d')!, bbEl: el.querySelector('.bb')!, nameEl: el.querySelector('.name-3d b')!, subEl: el.querySelector('.name-3d small')!, waitEl: el.querySelector('.wait-3d')!,
      status: 'idle', talking: false, tired: false, cycle: Math.random() * 20, cur: { torso: 0, head: 0, armL: 0.05, armR: 0.05, rollL: 0, rollR: 0 },
      walker: newWalker(DOOR), seated: false, bb: '\u0000', idleTalking: false, lookId,
    };
    n.label.center.set(0.5, 1);
    standBody.root.add(n.label); n.label.position.set(0, 2.05, 0);
    this.people.set(a.id, n);
    return n;
  }

  /** ours: the chosen preset changed (also for agents already in the office): rebuild both bodies, keep the label. */
  private relook(n: Person, a: AgentUI) {
    const id = currentLook(agentKey(a)) ?? ''; if (id === n.lookId) return;
    n.lookId = id; const look = lookFor(a), sitBody = buildPerson(look, true), standBody = buildPerson(look, false);
    sitBody.root.position.copy(n.sitBody.root.position); sitBody.root.rotation.copy(n.sitBody.root.rotation); standBody.root.position.copy(n.standBody.root.position); standBody.root.rotation.copy(n.standBody.root.rotation);
    sitBody.root.visible = n.sitBody.root.visible; standBody.root.visible = n.standBody.root.visible;
    this.group.remove(n.sitBody.root, n.standBody.root); this.group.add(sitBody.root, standBody.root); n.sitBody = sitBody; n.standBody = standBody;
    (n.seated ? sitBody.root : standBody.root).add(n.label); n.el.style.setProperty('--tint', look.accent ?? ROOM_COLOR);
  }
  /** ours: throw an agent (or a side character) to the crocodiles. The agent flies in an arc, gets eaten, and walks back in 20 s later. */
  throwIt(m: Pick<MenuTarget, 'kind' | 'id'>) {
    if (this.povView.pov && this.povView.pov.kind === m.kind && this.povView.pov.id === m.id) this.exitPov();
    if (m.kind === 'ent') { this.town.throwEnt(m.id); return; }
    const n = this.people.get(m.id), a = this.s?.agents[m.id]; if (!n || !a || n.goneUntil) return;
    const from = new THREE.Vector3(); (n.seated ? n.sitBody : n.standBody).root.getWorldPosition(from);
    const fig = buildPerson(lookFor(a), false).root; fig.position.copy(from); this.group.add(fig);
    this.throws.push({ m: fig, from, to: this.town.pondAt, start: this.clock.elapsedTime });
    n.goneUntil = Date.now() + RESPAWN_MS;
  }
  private updateThrows(t: number) {
    for (let i = this.throws.length - 1; i >= 0; i--) {
      const b = this.throws[i], p = (t - b.start) / THROW_FLY;
      if (p >= 1) { this.group.remove(b.m); this.throws.splice(i, 1); this.town.eat(Date.now()); continue; }
      b.m.position.lerpVectors(b.from, b.to, p); b.m.position.y = b.from.y + Math.sin(p * Math.PI) * (3 + b.from.distanceTo(b.to) * 0.15);
      b.m.rotation.set(p * 9, p * 3, 0);
    }
  }

  /** Feed the latest reducer state. Cheap: only touches DOM when a value changed. */
  update(s: DeckState, now: number) {
    this.s = s;
    this.town.setItops(s.itops);
    for (const id of s.order) { const a = s.agents[id]; if (a && isFree(a)) this.freeSince[id] ??= now; else delete this.freeSince[id]; }
    this.idle = idlePlans(s.agents, s.order, s.messages, now, this.freeSince);
    // Boss walkthrough: cancel outdoor idle, sit up, whisper.
    if (this.town?.bossActive) {
      this.idle = {};
      for (const id of s.order) {
        const n = this.people.get(id); if (!n) continue;
        n.idleKind = undefined;
        if (!n.el.classList.contains('boss-here')) {
          n.el.classList.add('boss-here');
          const line = ['Sếp tới kìa!', 'Ngồi ngay ngắn!', 'Cất điện thoại!', 'Giả vờ code!'][Math.abs(hashBoss(id + now)) % 4];
          if (n.walker.phase === 'seated' || n.walker.phase === 'waiting') {
            n.bb = `boss|${line}`; n.el.classList.add('has-bubble'); n.bbEl.textContent = line;
          }
        }
      }
    } else {
      for (const n of this.people.values()) n.el.classList.remove('boss-here');
    }
    for (const id of s.order) {
      const a = s.agents[id]; if (!a) continue;
      const n = this.people.get(id) ?? this.addPerson(a);
      this.relook(n, a);
      const name = currentName(agentKey(a)) ?? a.name; if (n.nameEl.textContent !== name) n.nameEl.textContent = name;
      const status = officeStatus(a.state);
      if (status !== n.status) { n.el.classList.remove(`st-${n.status}`); n.status = status; }
      n.el.classList.add(`st-${status}`);
      if (n.el.dataset.state !== a.state) n.el.dataset.state = a.state;
      n.talking = a.state === 'talking'; n.tired = a.state === 'error';
      const idle = this.idle[id], arrived = !!idle && n.walker.phase === 'waiting' && n.walker.goalKey === idle.key;
      const b = officeBubble(a, idle, arrived, now); // arrived: small talk only (a done result stays in the panel)
      n.idleTalking = arrived && b.show; n.idleKind = idle && arrived ? idle.kind : undefined;
      n.el.classList.toggle('scuffle', n.idleKind === 'fight');
      const key = `${b.show}|${b.dots}|${b.text}`;
      if (key !== n.bb) {
        n.bb = key; n.el.classList.toggle('has-bubble', b.show); n.bbEl.textContent = b.text;
        if (b.dots) { const c = document.createElement('span'); c.className = 'dots'; c.append(...[0, 1, 2].map(() => document.createElement('i'))); n.bbEl.append(c); }
      }
      const sub = subtitleFor(a); if (n.subEl.textContent !== sub) n.subEl.textContent = sub;
      if (n.waitEl.textContent) n.waitEl.textContent = ''; // keep labels to name + short status
    }
    for (const [id, n] of this.people) if (!s.agents[id]) {
      if (this.povView.pov?.kind === 'agent' && this.povView.pov.id === id) this.exitPov();
      this.group.remove(n.sitBody.root, n.standBody.root); n.el.remove(); this.people.delete(id);
    } // session left
    for (const id in this.freeSince) if (!s.agents[id]) delete this.freeSince[id]; // a swept session coming back with the same ids starts fresh
    const nAgents = s.order.length; this.roomLabel.textContent = nAgents ? `${nAgents} ${nAgents === 1 ? 'person' : 'people'}` : 'empty';
    for (const m of newFlights(s, this.lastMsg)) this.flyPaper(m.from, m.to);
    if (s.messages.length) this.lastMsg = Math.max(this.lastMsg, ...s.messages.map((m) => m.ts));
  }

  // ---------- Animation (reference capNhatNguoi → animateSeated, tuTheHelpDesk walking pose → animateStanding) ----------
  private animateSeated(n: Person, t: number, dt: number) {
    const h = n.sitBody, s = n.status, w = t + n.cycle, k = Math.min(1, dt * 6);
    const armRest = -1.12;
    const target = { torso: 0, head: 0, armL: armRest, armR: armRest, rollL: 0, rollR: 0, lid: LID_OPEN };
    const wobble = { torso: 0, headX: 0, headY: 0, headZ: 0, armL: 0, armR: 0, rollZ: 0, bounce: 0 };
    switch (s) {
      case 'working': target.head = 0.14; wobble.armL = 0.13 * Math.sin(w * 17); wobble.armR = 0.13 * Math.sin(w * 17 + 1.7); wobble.headY = 0.06 * Math.sin(w * 1.1); break;
      case 'done': target.armL = target.armR = -2.9; target.rollL = target.rollR = 0.55; wobble.bounce = Math.abs(Math.sin(w * 6)) * 0.22; wobble.rollZ = 0.15 * Math.sin(w * 6); break;
      case 'error': target.head = 0.18; target.armR = -2.7; target.rollR = 0.35; wobble.headY = 0.3 * Math.sin(w * 12) * (0.4 + 0.6 * Math.abs(Math.sin(w * 0.8))); break;
      case 'thinking': target.armR = -2.25; target.rollR = -0.45; wobble.headZ = 0.13 + 0.04 * Math.sin(w * 1.5); wobble.headY = 0.15 * Math.sin(w * 0.7); break;
      case 'talking': target.torso = 0.08; wobble.headZ = 0.12; wobble.bounce = Math.abs(Math.sin(w * 3)) * 0.04; break;
      default: wobble.torso = 0.012 * Math.sin(w * 2); wobble.headY = 0.3 * Math.sin(w * 0.45) * Math.max(0, Math.sin(w * 0.17)); break;
    }
    if (n.tired) { target.head += 0.15; wobble.armL *= 0.5; wobble.armR *= 0.5; }
    const c = n.cur;
    c.torso = lerp(c.torso, target.torso, k); c.head = lerp(c.head, target.head, k); c.armL = lerp(c.armL, target.armL, k); c.armR = lerp(c.armR, target.armR, k); c.rollL = lerp(c.rollL, target.rollL, k); c.rollR = lerp(c.rollR, target.rollR, k);
    h.torso.rotation.x = c.torso + wobble.torso;
    h.head.rotation.set(c.head + wobble.headX, wobble.headY, wobble.headZ);
    h.arms[0].rotation.x = c.armL + wobble.armL; h.arms[1].rotation.x = c.armR + wobble.armR;
    h.arms[0].rotation.z = -c.rollL; h.arms[1].rotation.z = c.rollR + wobble.rollZ;
    h.root.position.y = wobble.bounce;
    const blink = ((w * 0.27) % 1) < 0.035;
    for (const m of h.eyes) m.scale.y = blink ? 0.15 : 1;
    h.mouth.scale.y = n.talking ? 1 + 2.6 * Math.abs(Math.sin(w * 15)) : s === 'done' ? 3 : 1;
    h.sweat.visible = n.tired; if (n.tired) h.sweat.position.y = 0.5 - ((w * 0.5) % 1) * 0.2;
    this.updateRig(n.rig, s, w, dt, target.lid);
  }
  private updateRig(b: DeskRig | null, s: OfficeStatus | null, w: number, dt: number, lid = LID_OPEN) {
    if (!b) return;
    b.cur = lerp(b.cur, lid, Math.min(1, dt * 6)); b.lid.rotation.x = b.cur;
    b.screen.emissiveIntensity = s === 'working' ? 0.85 + 0.25 * Math.sin(w * 7) : s ? 0.25 : 0.05;
    b.logo.emissiveIntensity = s === 'working' ? 1.2 : 0.15;
    b.specks.forEach((m, i) => {
      m.visible = s === 'working'; if (!m.visible) return;
      const p = (w * 0.55 + i / 3) % 1;
      m.position.set(Math.sin(p * 7 + i * 2) * 0.2, 1.12 + p * 0.9, 0.82); m.scale.setScalar(0.11 * (1 - p) + 0.01); m.rotation.set(p * 4, p * 5, 0);
    });
  }
  private animateStanding(n: Person, t: number, dt: number, walking: boolean) {
    const h = n.standBody, w = t + n.cycle, k = Math.min(1, dt * (walking ? 16 : 7));
    let torso = 0, head = 0, headY = 0, armL = 0.05, armR = 0.05, legX = 0, bob = 0, talking = false;
    if (walking) {
      n.cycle += dt * 1.6 * 3.9; const s = Math.sin(n.cycle * 1.0);
      legX = 0.85 * s; armL = -0.9 * s; armR = 0.9 * s; torso = 0.16; bob = Math.abs(Math.cos(n.cycle)) * 0.08;
    } else if (n.idleKind === 'fight') { // ours: playful scuffle, alternating punches with a little hop
      armL = -1.55 + 1.1 * Math.max(0, Math.sin(w * 9)); armR = -1.55 + 1.1 * Math.max(0, Math.sin(w * 9 + Math.PI));
      torso = 0.18; headY = 0.15 * Math.sin(w * 7); bob = Math.abs(Math.sin(w * 9)) * 0.07; talking = true;
    } else if (n.idleKind === 'pool') { // ours: leaning over the table, cue arm stroking now and then
      torso = 0.42; head = -0.25; armL = -1.25; armR = -1.25 + 0.3 * Math.max(0, Math.sin(w * 2.2)) * (Math.sin(w * 0.5) > 0 ? 1 : 0); talking = n.idleTalking;
    } else if (n.idleKind === 'coffee') { // ours: sipping
      armR = -1.9 + 0.35 * Math.max(0, Math.sin(w * 0.9)); armL = -0.2; head = -0.08 * Math.max(0, Math.sin(w * 0.9)); talking = n.idleTalking;
    } else if (n.idleKind === 'massage') { // ours: lying on a Xuka massage bed
      armL = armR = -0.2; torso = 0; head = 0.1; talking = n.idleTalking;
    } else if (n.idleKind === 'bbq' || n.idleKind === 'beer') { // ours: eating BBQ or drinking at the beer stall
      armR = -1.7 + 0.25 * Math.max(0, Math.sin(w * 0.8)); armL = -0.3; head = -0.05; talking = n.idleTalking;
    } else if (n.idleKind === 'romance') { // ours: secret garden kiss lean
      armR = -0.95; armL = -0.95; torso = 0.18; head = -0.15; talking = n.idleTalking;
    } else if (n.idleKind === 'gym') {
      armL = -1.35 + 0.45 * Math.sin(w * 5); armR = -1.35 + 0.45 * Math.sin(w * 5 + Math.PI); talking = n.idleTalking;
    } else if (n.idleKind === 'smoke' || n.idleKind === 'gate' || n.idleKind === 'pod') {
      armR = -0.85 + 0.2 * Math.sin(w * 1.8); armL = -0.3; head = -0.06; talking = n.idleTalking;
    } else if (n.idleKind === 'atm' || n.idleKind === 'print') {
      armR = -1.6 + 0.2 * Math.max(0, Math.sin(w * 1.2)); armL = -0.4; head = -0.1; talking = n.idleTalking;
    } else if (n.idleKind === 'chat' && !n.idleTalking) { // ours: listening, arms down, nodding
      head = 0.08 * Math.max(0, Math.sin(w * 2.4)); headY = 0.05 * Math.sin(w * 0.9); torso = 0.012 * Math.sin(w * 2);
    } else { // standing at a colleague's desk: the reference's "le_tan" (receptionist) chatting pose
      armR = -0.7 + 0.35 * Math.sin(w * 3); armL = -0.25 + 0.2 * Math.sin(w * 2.3); headY = 0.1 * Math.sin(w * 1.7); talking = true; torso = 0.012 * Math.sin(w * 2);
    }
    h.root.position.y = bob;
    h.legs[0].rotation.x = lerp(h.legs[0].rotation.x, legX, k); h.legs[1].rotation.x = lerp(h.legs[1].rotation.x, -legX, k);
    h.torso.rotation.x = lerp(h.torso.rotation.x, torso, k); h.head.rotation.x = lerp(h.head.rotation.x, head, k); h.head.rotation.y = lerp(h.head.rotation.y, headY, k);
    h.arms[0].rotation.x = lerp(h.arms[0].rotation.x, armL, k); h.arms[1].rotation.x = lerp(h.arms[1].rotation.x, armR, k);
    const blink = ((w * 0.27) % 1) < 0.035; for (const m of h.eyes) m.scale.y = blink ? 0.15 : 1;
    h.mouth.scale.y = talking ? 1 + 2.4 * Math.abs(Math.sin(w * 13)) : 1;
    h.sweat.visible = n.tired;
  }
  private updatePerson(n: Person, t: number, dt: number) {
    const s = this.s!; const a = s.agents[n.id]; if (!a) return;
    if (n.goneUntil) { // ours: eaten by the crocodiles; walks back in from the door afterwards
      const gone = Date.now() < n.goneUntil; n.sitBody.root.visible = false; n.standBody.root.visible = false; n.el.style.display = gone ? 'none' : '';
      if (gone) { this.updateRig(n.rig, null, t, dt); return; }
      n.goneUntil = undefined; n.held = false; n.walker = newWalker(DOOR); n.seated = false; n.standBody.root.visible = true; n.standBody.root.add(n.label); n.label.position.set(0, 2.05, 0);
    }
    const hold = this.town.carryPose();
    if ((hold && hold.agentId === n.id) || walkerHeldByLayoff(n.id, this.town.ent('layoff'))) {
      const pose = hold ?? (() => {
        const L = this.town.ent('layoff')!, [lx, lz] = toWorld(L);
        return { agentId: n.id, ...graspWorldFromCarrier(lx, lz), heading: 0 };
      })();
      n.held = true; n.idleKind = undefined; n.idleTalking = false;
      if (n.seated) { n.seated = false; n.standBody.root.add(n.label); n.label.position.set(0, 2.05, 0); }
      n.sitBody.root.visible = false; n.standBody.root.visible = true;
      n.standBody.root.position.set(pose.x, pose.y, pose.z);
      n.standBody.root.rotation.set(0.4, pose.heading, 0);
      n.walker = { pos: [pose.x, 0, pose.z], heading: pose.heading, path: [], seg: 0, goalKey: '', phase: 'waiting' };
      if (n.el.dataset.phase !== 'carried') n.el.dataset.phase = 'carried';
      this.animateStanding(n, t, dt, false);
      this.updateRig(n.rig, null, t, dt);
      return;
    }
    if (n.held) { n.held = false; n.standBody.root.rotation.x = 0; }
    const goal = officeGoal(a, s.agents, s.messages, this.idle[n.id]);
    n.walker = stepWalker(n.walker, goal, dt, officePlan, walkerSpeedFor(goal, a.state));
    if (n.walker.phase !== 'waiting') n.idleKind = undefined;
    if (n.el.dataset.phase !== n.walker.phase) n.el.dataset.phase = n.walker.phase;
    const seated = n.walker.phase === 'seated';
    if (seated !== n.seated) {
      n.seated = seated; n.sitBody.root.visible = seated; n.standBody.root.visible = !seated;
      (seated ? n.sitBody.root : n.standBody.root).add(n.label); n.label.position.set(0, seated ? 1.95 : 2.05, 0);
    }
    if (seated) { this.animateSeated(n, t, dt); return; }
    const [x, , z] = n.walker.pos;
    const massage = n.idleKind === 'massage';
    n.standBody.root.position.set(x, massage ? 0.72 : 0, z);
    n.standBody.root.rotation.y = n.walker.heading;
    n.standBody.root.rotation.x = massage ? -Math.PI / 2 : 0;
    if (n.idleKind === 'romance') {
      const now = Date.now();
      if (now > this.heartCd) { this.hearts.burst(x, z, now); this.heartCd = now + 900; }
    }
    this.animateStanding(n, t, dt, n.walker.phase === 'walking');
    this.updateRig(n.rig, null, t, dt);
  }

  // ---------- Flying paper between desks on every message (reference bayPhieu → flyPaper) ----------
  private flyPaper(fromId: string, toId: string) {
    const a = this.people.get(fromId), b = this.people.get(toId);
    if (!a || !b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = new THREE.Vector3(); (a.seated ? a.sitBody : a.standBody).head.getWorldPosition(from);
    const to = new THREE.Vector3(); (b.seated && b.rig ? b.rig.lid : (b.seated ? b.sitBody : b.standBody).head).getWorldPosition(to);
    const m = block(this.scene, 0.3, 0.02, 0.38, '#ffffff', from.x, from.y, from.z, false);
    this.flights.push({ m, from, to, start: this.clock.elapsedTime, dur: 1.1 + from.distanceTo(to) * 0.02 });
  }
  private updateFlights(t: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const b = this.flights[i], p = (t - b.start) / b.dur;
      if (p >= 1) { this.scene.remove(b.m); this.flights.splice(i, 1); continue; }
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      b.m.position.lerpVectors(b.from, b.to, e); b.m.position.y += Math.sin(p * Math.PI) * (1.6 + b.from.distanceTo(b.to) * 0.12);
      b.m.rotation.set(Math.sin(p * Math.PI) * 0.6, p * 7, 0);
    }
  }

  // ---------- Day/night + camera (reference datNgayDem, gocMacDinh, phong, giuTrongBien → setNight, defaultView, zoom, clampToBounds) ----------
  setNight(isNight: boolean) {
    this.night = isNight;
    (this.scene.background as THREE.Color).set(isNight ? '#121830' : '#dfe9f1');
    this.sky.intensity = isNight ? 0.5 : 1.6; this.sky.color.set(isNight ? '#8d9cd8' : '#fffaf0'); this.sky.groundColor.set(isNight ? '#2a2440' : '#c8b49a');
    this.sun.intensity = isNight ? 0.45 : 2.2; this.sun.color.set(isNight ? '#a9bcff' : '#fff1dc');
    this.windowGlass.color.set(isNight ? '#1d2c52' : '#bfe3ff'); this.windowGlass.emissive.set(isNight ? '#2a3f6e' : '#cfeaff'); this.windowGlass.emissiveIntensity = isNight ? 0.55 : 0.35;
    for (const d of this.roomLights) d.intensity = isNight ? 9 : 0;
    for (const m of this.lampShades) m.emissiveIntensity = isNight ? 1.3 : 0;
    this.nightBtn.innerHTML = isNight ? SVG.night : SVG.day;
    this.nightBtn.title = isNight ? 'Night: click for day' : 'Day: click for night';
  }
  private defaultView() {
    const { x0, x1, z0, z1 } = TOWN_BOUNDS; // ours: fit the whole town
    const target = new THREE.Vector3((x0 + x1) / 2, 0.5, (z0 + z1) / 2 + 0.6);
    // ours: fit the whole (wide) floor in the current frame instead of the reference's fixed R * 0.8 + 3
    const asp = (this.viewport.clientWidth || 1200) / (this.viewport.clientHeight || 800), tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const R = Math.max(((x1 - x0) / 2) / (tanV * asp) * 1.12, ((z1 - z0) / 2) / tanV * 0.95);
    const dir = new THREE.Vector3(0.05, 1.05, 1).normalize();
    const d = Math.min(R, this.controls.maxDistance); this.farFrom = d * 1.2; // names/bubbles compact only when zoomed out past the fitted view
    return { target, pos: target.clone().addScaledVector(dir, d) };
  }
  private moveView(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur = 0.6) {
    this.camAnim = { fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos, toTarget, start: this.clock.elapsedTime, dur };
  }
  private zoom(factor: number) {
    const d = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(d.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.moveView(this.controls.target.clone().add(d.setLength(len)), this.controls.target.clone(), 0.35);
  }
  private updateView(t: number) {
    const g = this.camAnim; if (!g) return;
    const p = Math.min(1, (t - g.start) / g.dur), e = 1 - (1 - p) ** 3;
    this.camera.position.lerpVectors(g.fromPos, g.toPos, e); this.controls.target.lerpVectors(g.fromTarget, g.toTarget, e);
    if (p >= 1) this.camAnim = null;
  }
  private clampToBounds() {
    const t = this.controls.target;
    const x = THREE.MathUtils.clamp(t.x, TOWN_BOUNDS.x0, TOWN_BOUNDS.x1), z = THREE.MathUtils.clamp(t.z, TOWN_BOUNDS.z0, TOWN_BOUNDS.z1);
    if (x === t.x && z === t.z) return;
    this.camera.position.x += x - t.x; this.camera.position.z += z - t.z; t.x = x; t.z = z;
  }

  private frame() {
    const dt = Math.min(0.1, this.clock.getDelta()), t = this.clock.elapsedTime;
    if (this.povView.pov) this.camAnim = null; else this.updateView(t);
    if (!this.povView.pov) this.controls.update();
    if (this.s) for (const n of this.people.values()) this.updatePerson(n, t, dt);
    this.updateFlights(t); this.updateThrows(t);
    // Layoff may hunt free (idle/done) office agents who are out of the building / wandering.
    const preyNow = Date.now();
    const prey = [];
    if (this.s) {
      for (const id of this.s.order) {
        const a = this.s.agents[id], n = this.people.get(id);
        if (!a || !n || n.goneUntil || n.held || !isFree(a) || walkerHeldByLayoff(id, this.town.ent('layoff'))) continue;
        const g = (n.seated ? n.sitBody : n.standBody).root;
        const wp = new THREE.Vector3(); g.getWorldPosition(wp);
        const pt = fromWorld(wp.x, wp.z);
        prey.push({ id, x: pt.x, y: pt.y });
      }
    }
    this.town.setAgentPrey(prey);
    this.town.tick(t, dt, preyNow);
    if (this.povView.pov && !this.applyPov()) this.exitPov();
    const ev = this.town.consumeLayoffEvent();
    if (ev) {
      const n = this.people.get(ev.agentId), a = this.s?.agents[ev.agentId];
      if (n && a && !n.goneUntil) {
        if (ev.type === 'pond') {
          const from = new THREE.Vector3();
          if (n.held) n.standBody.root.getWorldPosition(from);
          else if (ev.from) { const [x, z] = toWorld(ev.from); from.set(x, GRASP_LIFT, z); }
          else (n.seated ? n.sitBody : n.standBody).root.getWorldPosition(from);
          const fig = buildPerson(lookFor(a), false).root; fig.position.copy(from); this.group.add(fig);
          this.throws.push({ m: fig, from: from.clone(), to: this.town.pondAt, start: this.clock.elapsedTime });
        } else {
          this.town.eat(preyNow, 1800); // brief chomp cue
        }
        n.goneUntil = preyNow + RESPAWN_MS;
        if (this.povView.pov?.kind === 'agent' && this.povView.pov.id === ev.agentId) this.exitPov();
      }
    }
    this.labelRenderer.domElement.classList.toggle('far', this.camera.position.distanceTo(this.controls.target) > this.farFrom);
    this.renderer.render(this.scene, this.camera); this.labelRenderer.render(this.scene, this.camera);
    this.writeCam();
    if (t - this.lastLayout > 0.12) { this.lastLayout = t; this.spreadLabels(); }
  }
  private lastLayout = -1; private shift = new Map<HTMLElement, number>();
  /** Ours (not in the reference): push overlapping names/bubbles apart with our tested resolveOverlaps (walk.ts). */
  private spreadLabels() {
    const top = this.viewport.getBoundingClientRect().top + 4, boxes: LabelBox[] = [], els = new Map<string, HTMLElement>();
    for (const n of this.people.values()) {
      for (const [el, fixed] of [[n.el.querySelector<HTMLElement>('.name-3d')!, true], [n.bubbleEl, false]] as const) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const id = `${n.id}:${fixed ? 'n' : 'b'}`; els.set(id, el);
        boxes.push({ id, x: r.left, y: r.top - (this.shift.get(el) ?? 0), w: r.width, h: r.height, fixed });
      }
    }
    const dy = resolveOverlaps(boxes, 4, 40, top);
    for (const [id, el] of els) {
      const d = Math.round(dy[id] ?? 0); if (d === (this.shift.get(el) ?? 0)) continue;
      this.shift.set(el, d); el.style.transform = d ? `translateY(${d}px)` : '';
    }
  }

  private onLabelsChanged = () => {
    applyLabelVisibility(this.roomLabelEl, isLabelOn('workroom'));
    this.town.refreshLabels();
  };
  dispose() {
    try { window.removeEventListener(LABELS_EVENT, this.onLabelsChanged); } catch { /* */ }
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect(); this.host.removeEventListener('click', this.onClick); this.host.removeEventListener('contextmenu', this.onMenuEv);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPtrDown);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('pointermove', this.onPtrMove); window.removeEventListener('pointerup', this.onPtrUp); window.removeEventListener('pointercancel', this.onPtrUp);
    try { delete (window as unknown as { __deckPov?: unknown }).__deckPov; } catch { /* */ }
    this.controls.dispose(); this.town.dispose();
    for (const b of this.flights) this.scene.remove(b.m);
    this.scene.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
    for (const r of this.owned) r.dispose();
    this.windowGlass.dispose(); this.renderer.dispose();
    this.host.innerHTML = ''; this.host.classList.remove('office3d-ref');

  }
}


function hashBoss(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
