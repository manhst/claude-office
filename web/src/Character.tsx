import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { Color, LoopRepeat, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import type { Clip } from './walk';

/** Quaternius "Universal Animation Library" mannequin (CC0), pruned to the 5 clips we use. Fetched only when the 3D view mounts. */
export function modelUrl(search: string = typeof location === 'undefined' ? '' : location.search): string {
  const m = /[?&]model=([\w-]+\.glb)(?:&|$)/.exec(search); // test hook (e.g. ?model=missing.glb), restricted to a bare file name in /models
  return `${(import.meta as any).env?.BASE_URL ?? '/'}models/${m ? m[1] : 'office-character.glb'}`;
}
const report = (role: string, kind: 'model' | 'capsule') => { const w = window as any; (w.__officeAvatars ??= {})[role] = kind; };

class Boundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
/** Character with graceful degradation: capsule while loading and forever if the GLB fails (404, bad file, no WebGL skinning). */
export function Character({ role, clip, color, capsule }: { role: string; clip: Clip; color: string; capsule: ReactNode }) {
  return (
    <Boundary fallback={capsule} onError={() => report(role, 'capsule')}>
      <Suspense fallback={capsule}><Model role={role} clip={clip} color={color} /></Suspense>
    </Boundary>
  );
}
function Model({ role, clip, color }: { role: string; clip: Clip; color: string }) {
  const { scene, animations } = useGLTF(modelUrl(), false, false);
  const root = useRef<Group>(null);
  const { obj, body } = useMemo(() => {
    const obj = SkeletonUtils.clone(scene) as Group; let body: MeshStandardMaterial | undefined;
    obj.traverse((o) => { const m = o as Mesh; if (!m.isMesh) return; m.frustumCulled = false; // skinned bounds don't follow the pose
      const mat = (m.material as MeshStandardMaterial).clone(); m.material = mat; if (mat.name === 'M_Main') body = mat; });
    return { obj, body };
  }, [scene]);
  const { actions } = useAnimations(animations, root);
  useEffect(() => { report(role, 'model'); }, [role]);
  useEffect(() => {
    const a = actions[clip]; if (!a) return;
    a.reset().setLoop(LoopRepeat, Infinity).fadeIn(0.3).play();
    return () => { a.fadeOut(0.3); };
  }, [actions, clip]);
  const target = useMemo(() => new Color(), []);
  useFrame((_, dt) => { if (body) { target.set(color); body.color.lerp(target, 1 - Math.exp(-6 * Math.min(dt, 0.1))); } });
  return <group ref={root}><primitive object={obj} /></group>;
}
export const preloadCharacter = () => useGLTF.preload(modelUrl(), false, false);
