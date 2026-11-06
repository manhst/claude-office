import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as THREE from 'three';
import {
  applyLook, cameraFromEye, canPov, clampLook, enterPovView, exitPovView, eyePush, lookDelta, PITCH_LIM, POV_FOV, POV_NEAR,
  snapsEqual, subjectGone, type CamSnap, type Eye,
} from '../src/povCam';
import { liveEye } from '../src/ref-vanphong/town3d';
import { TownMenu, type Menu } from '../src/town/Editor';

const OVER: CamSnap = { px: 4, py: 12, pz: 18, tx: 0, ty: 0.5, tz: 1, fov: 38, near: 0.1 };
const eyeZ: Eye = { x: 1, y: 1.6, z: 2, fx: 0, fy: 0, fz: 1 };

describe('canPov', () => {
  it('allows every menu character: agents, humans, pets, and the T-Rex', () => {
    expect(canPov('agent')).toBe(true);
    for (const k of ['npc', 'boss', 'itops', 'shipper', 'dog', 'cat', 'trex']) expect(canPov('ent', k)).toBe(true);
    expect(canPov('ent')).toBe(false);
    expect(canPov('ent', 'car')).toBe(false);
  });
});

describe('species eye push', () => {
  it('uses a shorter muzzle push for cat, longer for dog, longest for T-Rex — not the human face offset', () => {
    expect(eyePush()).toBe(0.18);
    expect(eyePush('npc')).toBe(0.18);
    expect(eyePush('cat')).toBe(0.14);
    expect(eyePush('dog')).toBe(0.22);
    expect(eyePush('trex')).toBe(0.34);
    expect(eyePush('dog')).not.toBe(eyePush());
    expect(eyePush('trex')).toBeGreaterThan(eyePush('dog'));
    expect(eyePush('dog')).toBeGreaterThan(eyePush('cat'));
  });
});

describe('look + camera pose', () => {
  it('identity look keeps rendered +Z and places the camera at the eye', () => {
    const a = cameraFromEye(eyeZ, { yaw: 0, pitch: 0 })!;
    expect(a.px).toBeCloseTo(1); expect(a.py).toBeCloseTo(1.6); expect(a.pz).toBeCloseTo(2);
    expect(a.tx - a.px).toBeCloseTo(0); expect(a.ty - a.py).toBeCloseTo(0); expect(a.tz - a.pz).toBeCloseTo(1);
  });
  it('yaw π/2 from +Z faces +X (natural heading + drag right)', () => {
    const f = applyLook(0, 0, 1, { yaw: Math.PI / 2, pitch: 0 })!;
    expect(f.x).toBeCloseTo(1); expect(f.y).toBeCloseTo(0); expect(f.z).toBeCloseTo(0);
  });
  it('positive pitch looks up; drag-up yields positive pitch', () => {
    const f = applyLook(0, 0, 1, { yaw: 0, pitch: 0.5 })!;
    expect(f.y).toBeGreaterThan(0.4); expect(f.z).toBeGreaterThan(0.7);
    expect(lookDelta(10, -8).dyaw).toBeGreaterThan(0);
    expect(lookDelta(10, -8).dpitch).toBeGreaterThan(0);
  });
  it('clamps pitch and wraps yaw; lying-down +Y forward stays looking up', () => {
    expect(clampLook({ yaw: 0, pitch: 0 }, 0, 9).pitch).toBeCloseTo(PITCH_LIM);
    expect(clampLook({ yaw: 0, pitch: 0 }, 0, -9).pitch).toBeCloseTo(-PITCH_LIM);
    const w = clampLook({ yaw: Math.PI - 0.01, pitch: 0 }, 0.1, 0).yaw;
    expect(w).toBeLessThan(0);
    const up = applyLook(0, 1, 0, { yaw: 0, pitch: 0 })!;
    expect(up.y).toBeCloseTo(1); expect(Math.abs(up.x) + Math.abs(up.z)).toBeLessThan(1e-9);
  });
  it('rejects NaN eyes so the scene can auto-exit instead of trapping the camera', () => {
    expect(cameraFromEye({ ...eyeZ, x: NaN }, { yaw: 0, pitch: 0 })).toBeUndefined();
    expect(cameraFromEye({ ...eyeZ, fy: Infinity }, { yaw: 0, pitch: 0 })).toBeUndefined();
  });
});

describe('live animal / T-Rex eyes', () => {
  function pair(z: number, y = 0.05) {
    const dau = new THREE.Group();
    const a = new THREE.Mesh(), b = new THREE.Mesh();
    a.position.set(-0.08, y, z); b.position.set(0.08, y, z); dau.add(a, b);
    return { dau, mat: [a, b] };
  }
  it('dog/cat eyes sit lower than a human head and look +Z, not inverted', () => {
    const { dau, mat } = pair(0.155);
    const e = liveEye(dau, mat, eyePush('dog'))!;
    expect(e.y).toBeCloseTo(0.05);
    expect(e.z).toBeCloseTo(0.155 + 0.22);
    expect(e.fz).toBeGreaterThan(0.99); expect(Math.abs(e.fx) + Math.abs(e.fy)).toBeLessThan(0.05);
    const { dau: cd, mat: cm } = pair(0.155);
    const c = liveEye(cd, cm, eyePush('cat'))!;
    expect(c.z).toBeCloseTo(0.155 + 0.14);
    expect(c.z).toBeLessThan(e.z);
  });
  it('T-Rex eyes are higher with a longer snout push; yaw follows the head', () => {
    const { dau, mat } = pair(0.26, 0.08);
    dau.position.y = 1.25;
    const e = liveEye(dau, mat, eyePush('trex'))!;
    expect(e.y).toBeCloseTo(1.33);
    expect(e.z).toBeCloseTo(0.26 + 0.34);
    expect(e.fz).toBeGreaterThan(0.99);
    dau.rotation.y = Math.PI / 2; dau.updateWorldMatrix(true, true);
    const r = liveEye(dau, mat, eyePush('trex'))!;
    expect(r.fx).toBeGreaterThan(0.99);
    expect(Math.abs(r.fz)).toBeLessThan(0.05);
  });
});

describe('view enter / exit / removal', () => {
  it('saves overview once, resets look, and restores the same snap on exit', () => {
    let v = enterPovView({ pov: null, saved: null }, { kind: 'agent', id: 'a1' }, OVER);
    expect(v.pov).toMatchObject({ kind: 'agent', id: 'a1', look: { yaw: 0, pitch: 0 } });
    expect(snapsEqual(v.saved!, OVER)).toBe(true);
    v = enterPovView(v, { kind: 'ent', id: 'dog' }, { ...OVER, px: 99, fov: POV_FOV, near: POV_NEAR });
    expect(v.pov?.id).toBe('dog');
    expect(snapsEqual(v.saved!, OVER)).toBe(true);
    const { view, restore } = exitPovView(v);
    expect(view.pov).toBeNull(); expect(view.saved).toBeNull();
    expect(snapsEqual(restore!, OVER)).toBe(true);
    expect(restore!.fov).toBe(38); expect(restore!.near).toBe(0.1);
  });
  it('auto-exit when the subject is gone, eaten, despawned, or a session agent leaves', () => {
    expect(subjectGone('agent', { agentPresent: true })).toBe(false);
    expect(subjectGone('agent', { agentPresent: false })).toBe(true);
    expect(subjectGone('agent', { agentPresent: true, gone: true })).toBe(true);
    expect(subjectGone('ent', { entPresent: true, entKind: 'npc', entAct: 'walk' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'npc', entAct: 'fall' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'npc', entAct: 'carried' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'npc', entAct: 'eaten' })).toBe(true);
    expect(subjectGone('ent', { entPresent: true, entKind: 'npc', entAct: 'gone' })).toBe(true);
    expect(subjectGone('ent', { entPresent: false, entKind: 'boss' })).toBe(true);
    expect(subjectGone('ent', { entPresent: true, entKind: 'dog', entAct: 'walk' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'dog', entAct: 'eaten' })).toBe(true);
    expect(subjectGone('ent', { entPresent: true, entKind: 'cat', entAct: 'gone' })).toBe(true);
    expect(subjectGone('ent', { entPresent: true, entKind: 'trex', entAct: 'hunt' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'trex', entAct: 'carry' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'trex', entAct: 'chomp' })).toBe(false);
    expect(subjectGone('ent', { entPresent: true, entKind: 'trex', entAct: 'gone' })).toBe(true);
  });
  it('exit with no session is a no-op (no stale restore pointer)', () => {
    const { view, restore } = exitPovView({ pov: null, saved: null });
    expect(view.pov).toBeNull(); expect(restore).toBeNull();
  });
});

describe('Nhìn từ nhân vật menu', () => {
  const m: Menu = { key: 'npc:npc-1', label: 'Tèo', x: 10, y: 20, kind: 'ent', id: 'npc-1' };
  it('adds the look action when onLook is provided and keeps rename/throw', () => {
    const html = renderToStaticMarkup(createElement(TownMenu, { m, onEdit: () => {}, onThrow: () => {}, onLook: () => {} }));
    expect(html).toMatch(/Nhìn từ nhân vật/);
    expect(html).toMatch(/ctx-look/);
    expect(html).toMatch(/Đặt tên/);
    expect(html).toMatch(/Ném cho cá sấu/);
    expect(html).not.toMatch(/emoji|😀/);
  });
  it('shows the look action for dog, cat, and T-Rex when onLook is provided', () => {
    for (const [id, label] of [['dog', 'Chos An'], ['cat', 'Meow'], ['layoff', 'Layoff']] as const) {
      const html = renderToStaticMarkup(createElement(TownMenu, { m: { ...m, id, key: `npc:${id}`, label }, onEdit: () => {}, onThrow: () => {}, onLook: () => {} }));
      expect(html).toMatch(/Nhìn từ nhân vật/);
      expect(html).toMatch(/Đặt tên/);
    }
  });
  it('omits the look action only when onLook is withheld', () => {
    const html = renderToStaticMarkup(createElement(TownMenu, { m: { ...m, id: 'dog', key: 'npc:dog' }, onEdit: () => {}, onThrow: () => {} }));
    expect(html).not.toMatch(/Nhìn từ nhân vật/);
    expect(html).toMatch(/Đặt tên/);
  });
});
