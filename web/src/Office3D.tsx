import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls, PerformanceMonitor, QuadraticBezierLine, RoundedBox } from '@react-three/drei';
import { Color, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { AgentUI, MessageUI, OfficeState } from './reducer';
import { BUBBLE_MS, DOOR, MSG_MS, SEAT_OFFSET, STATE_COLORS, add, allDesks, clampTarget, deskWorld, type Vec3 } from './layout';
import { clipFor, goalFor, newWalker, resolveOverlaps, stepWalker, type LabelBox, type Phase, type Walker } from './walk';
import { Character } from './Character';
import { ToolChip } from './Office2D';
import { IconCheck, IconMail, IconReply } from './icons';

/** Software rasterisers (SwiftShader/llvmpipe, e.g. headless CI) can't afford MSAA at 60fps; detect once. */
const SOFTWARE_GL = (() => { try { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|software/i.test(e ? String(c!.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''); } catch { return false; } })();

/** Software GL is fill-rate bound: render slightly under native resolution (the browser upscales). */
const SOFT_DPR = 0.85;

export default function Office3D({ s, now }: { s: OfficeState; now: number }) {
  const [fps, setFps] = useState(0);
  const [dpr, setDpr] = useState(SOFTWARE_GL ? SOFT_DPR : 1.5);
  const stage = useRef<HTMLElement>(null);
  useLabelLayout(stage);
  const agents = s.order.map((id) => s.agents[id]).filter(Boolean);
  const live = s.messages.filter((m) => now - m.ts < MSG_MS && s.agents[m.from] && s.agents[m.to]);
  return (
    <section className="stage3d" data-testid="office3d" ref={stage}>
      <Canvas camera={{ position: [0, 8.5, 11], fov: 45 }} dpr={dpr} gl={{ antialias: !SOFTWARE_GL, powerPreference: 'high-performance' }}>
        <color attach="background" args={['#16213a']} />
        <hemisphereLight args={['#e0e7ff', '#334155', 1.5]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[6, 10, 4]} intensity={1.9} />
        <Floor />
        {allDesks().map((d, i) => { const occ = agents.find((a) => a.desk.x === d.x && a.desk.y === d.y); return <Desk key={i} pos={deskWorld(d)} state={occ?.state} />; })}
        {agents.map((a) => <Avatar key={a.id} a={a} s={s} now={now} />)}
        {live.map((m, i) => <MessageArc key={`${m.ts}-${i}`} m={m} s={s} />)}
        <Controls />
        <FpsMeter onFps={setFps} />
        <PerformanceMonitor onDecline={() => setDpr(SOFTWARE_GL ? SOFT_DPR : 1)} onIncline={() => setDpr(SOFTWARE_GL ? SOFT_DPR : 1.5)} flipflops={3} onFallback={() => setDpr(SOFTWARE_GL ? SOFT_DPR : 1)} />
      </Canvas>
      <div className="hud" data-testid="fps">{fps} fps</div>
      {!agents.length && <div className="hud hud-center">Waiting for agents…</div>}
    </section>
  );
}
/** Every 120ms: measure the HTML labels, keep names fixed, push bubbles/cards/results up until nothing overlaps. */
function useLabelLayout(stage: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const t = setInterval(() => {
      const els = [...(stage.current?.querySelectorAll<HTMLElement>('[data-lbl]') ?? [])];
      const boxes: LabelBox[] = els.map((el, i) => { const r = el.getBoundingClientRect(), cur = Number(el.dataset.dy ?? 0);
        return { id: String(i), x: r.left, y: r.top - cur, w: r.width, h: r.height, fixed: el.dataset.lbl === 'fixed' }; }).filter((b) => b.w > 0);
      const dy = resolveOverlaps(boxes);
      boxes.forEach((b) => { const el = els[Number(b.id)], v = Math.round(dy[b.id] ?? 0); if (Number(el.dataset.dy ?? 0) !== v) { el.dataset.dy = String(v); el.style.transform = `translateY(${v}px)`; } });
    }, 120);
    return () => clearInterval(t);
  }, [stage]);
}
function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}><planeGeometry args={[20, 16]} /><meshStandardMaterial color="#2a3a5c" /></mesh>
      <gridHelper args={[20, 20, '#3d5079', '#33446a']} position={[0, 0, 0]} />
      <mesh position={[0, 1.2, -8]}><boxGeometry args={[20, 2.4, 0.2]} /><meshStandardMaterial color="#24324f" /></mesh>
      <mesh position={[DOOR[0], 1, -7.85]}><boxGeometry args={[1.6, 2, 0.1]} /><meshStandardMaterial color="#475569" /></mesh>
    </group>
  );
}
function Desk({ pos, state }: { pos: Vec3; state?: AgentUI['state'] }) {
  const screen = useRef<MeshStandardMaterial>(null);
  const tint = useMemo(() => new Color(), []);
  useFrame((st) => { // subtle glow always; brighter + flicker while the occupant types
    const m = screen.current; if (!m) return;
    tint.set(state ? STATE_COLORS[state] : '#334155').lerp(new Color('#60a5fa'), 0.55);
    m.emissive.copy(tint);
    m.emissiveIntensity = !state ? 0.25 : state === 'working' ? 0.85 + Math.sin(st.clock.elapsedTime * 23) * 0.12 : 0.6;
  });
  return (
    <group position={pos}>
      <RoundedBox args={[2.6, 0.12, 1.2]} radius={0.04} position={[0, 0.75, 0]}><meshStandardMaterial color={state ? '#7c8ba1' : '#5b6b82'} /></RoundedBox>
      {[[-1.15, -0.5], [1.15, -0.5], [-1.15, 0.5], [1.15, 0.5]].map(([x, z], i) => <mesh key={i} position={[x, 0.37, z]}><boxGeometry args={[0.08, 0.74, 0.08]} /><meshStandardMaterial color="#475569" /></mesh>)}
      <mesh position={[0, 1.15, -0.37]}><boxGeometry args={[0.95, 0.6, 0.04]} /><meshStandardMaterial color="#1e293b" /></mesh>
      <mesh position={[0, 1.15, -0.345]}><planeGeometry args={[0.86, 0.5]} /><meshStandardMaterial ref={screen} color="#0b1220" emissive="#1e3a8a" emissiveIntensity={0.25} toneMapped={false} /></mesh>
      <mesh position={[0, 0.82, 0.1]}><boxGeometry args={[0.6, 0.03, 0.2]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh position={[0, 0.45, SEAT_OFFSET[2] + 0.1]}><boxGeometry args={[0.55, 0.08, 0.5]} /><meshStandardMaterial color="#3b4a63" /></mesh>
    </group>
  );
}
function Capsule({ color }: { color: string }) {
  const mat = useRef<MeshStandardMaterial>(null); const t = useMemo(() => new Color(), []);
  useFrame((_, dt) => { if (mat.current) { t.set(color); mat.current.color.lerp(t, 1 - Math.exp(-6 * Math.min(dt, 0.1))); mat.current.emissive.copy(mat.current.color).multiplyScalar(0.25); } });
  return (
    <group position={[0, 0.75, 0]} name="capsule">
      <mesh><capsuleGeometry args={[0.35, 0.7, 8, 16]} /><meshStandardMaterial ref={mat} color={color} roughness={0.45} /></mesh>
      <mesh position={[0, 0.2, 0.33]}><boxGeometry args={[0.36, 0.1, 0.05]} /><meshStandardMaterial color="#0f172a" /></mesh>
    </group>
  );
}
/** Three dots floating in sequence above the head while thinking. */
function ThinkingDots() {
  const refs = [useRef<Mesh>(null), useRef<Mesh>(null), useRef<Mesh>(null)];
  useFrame((st) => refs.forEach((r, i) => { if (r.current) { const k = (Math.sin(st.clock.elapsedTime * 4 - i * 0.9) + 1) / 2; r.current.position.y = k * 0.12; r.current.scale.setScalar(0.7 + k * 0.5); } }));
  return <group>{refs.map((r, i) => <mesh key={i} ref={r} position={[(i - 1) * 0.16, 0, 0]}><sphereGeometry args={[0.05, 8, 8]} /><meshBasicMaterial color="#c4b5fd" /></mesh>)}</group>;
}
const HEAD_Y: Record<Phase, number> = { seated: 1.45, walking: 1.95, waiting: 1.95 };
function Avatar({ a, s, now }: { a: AgentUI; s: OfficeState; now: number }) {
  const g = useRef<Group>(null); const head = useRef<Group>(null); const fx = useRef<Group>(null);
  const walker = useRef<Walker>(newWalker());
  const [phase, setPhase] = useState<Phase>('walking');
  const goal = goalFor(a, s.agents, s.messages);
  useFrame((_, dt) => {
    const w = (walker.current = stepWalker(walker.current, goal, Math.min(dt, 0.1)));
    g.current?.position.set(w.pos[0], 0, w.pos[2]);
    if (g.current) g.current.rotation.y = w.heading;
    if (head.current) head.current.position.y += (HEAD_Y[w.phase] - head.current.position.y) * Math.min(1, dt * 6);
    if (fx.current) fx.current.position.y = head.current?.position.y ?? 1.5;
    if (w.phase !== phase) setPhase(w.phase);
  });
  const showBubble = a.state !== 'done' && a.text && a.textTs && (now - a.textTs < BUBBLE_MS || a.state === 'talking'); // when done, the result card replaces it
  const color = STATE_COLORS[a.state];
  return (
    <group>
      <group ref={g} position={DOOR}>
        <group><Character role={a.role} clip={clipFor(phase, a.state)} color={color} capsule={<Capsule color={color} />} /></group>
        <group ref={fx} position={[0, 1.5, 0]}>{a.state === 'thinking' && <group position={[0, 0.12, 0]}><ThinkingDots /></group>}</group>
        <group ref={head} position={[0, 1.95, 0]}>
          {/* name label: always visible, never displaced */}
          <Html position={[0, 0.42, 0]} center zIndexRange={[40, 20]} className="h3-wrap">
            <div className="name3d" data-lbl="fixed" data-state={a.state} data-phase={phase} data-testid={`agent3d-${a.role}`}><i style={{ background: color }} />{a.name} <small>{a.state}</small></div>
          </Html>
          {(showBubble || a.tool || (a.state === 'done' && a.result)) && (
            <Html position={[0, 0.42, 0]} center zIndexRange={[30, 10]} className="h3-wrap">
              <div className="h3 h3-above" data-lbl="move">
                {showBubble && <div className="bubble bubble3d">{a.text}</div>}
                <ToolChip a={a} />
                {a.state === 'done' && a.result && <div className="result result3d"><IconCheck size={12} /><span className="clamp">{a.result}</span></div>}
              </div>
            </Html>
          )}
        </group>
      </group>
    </group>
  );
}
function MessageArc({ m, s }: { m: MessageUI; s: OfficeState }) {
  const fromDesk = s.agents[m.from].desk, toDesk = s.agents[m.to].desk;
  // memoised so the Line2 geometry is not rebuilt on every 250ms UI tick
  const { a, b, mid, apex } = useMemo(() => {
    const a = add(add(deskWorld(fromDesk), SEAT_OFFSET), [0, 1.6, 0]);
    const b = add(add(deskWorld(toDesk), SEAT_OFFSET), [0, 1.6, 0]);
    const mid: Vec3 = [(a[0] + b[0]) / 2, 3.4 + (m.kind === 'reply' ? 0.5 : 0), (a[2] + b[2]) / 2];
    const apex: Vec3 = [0, 1, 2].map((i) => 0.25 * a[i] + 0.5 * mid[i] + 0.25 * b[i]) as Vec3; // the curve's true midpoint (t = 0.5)
    return { a, b, mid, apex };
  }, [fromDesk.x, fromDesk.y, toDesk.x, toDesk.y, m.kind]);
  const ref = useRef<any>(null);
  useFrame((_, dt) => { if (ref.current?.material) ref.current.material.dashOffset -= dt * 2; });
  return (
    <group>
      <QuadraticBezierLine ref={ref} start={a} end={b} mid={mid} color={m.kind === 'reply' ? '#4ade80' : '#38bdf8'} lineWidth={3} dashed dashSize={0.3} gapSize={0.2} />
      <Html position={apex} center zIndexRange={[30, 10]} className="h3-wrap">
        <div className={`envelope env-${m.kind} env3d`} data-lbl="move" data-testid="msg-card3d">{m.kind === 'ask' ? <IconMail /> : <IconReply />}<span>{m.text}</span></div>
      </Html>
    </group>
  );
}
function Controls() {
  const ref = useRef<OrbitImpl>(null);
  return <OrbitControls ref={ref as any} makeDefault target={[0, 0.6, 0.4]} enableDamping minDistance={7} maxDistance={22}
    minPolarAngle={0.25} maxPolarAngle={Math.PI / 2 - 0.12} screenSpacePanning={false}
    onChange={() => { const c = ref.current; if (!c) return; const [x, y, z] = clampTarget([c.target.x, c.target.y, c.target.z]); c.target.set(x, y, z); }} />;
}
function FpsMeter({ onFps }: { onFps: (n: number) => void }) {
  const acc = useRef({ frames: 0, t: 0 });
  useFrame((_, dt) => {
    const a = acc.current; a.frames++; a.t += dt;
    if (a.t >= 1) { const f = Math.round(a.frames / a.t); (window as any).__officeFps = f; onFps(f); a.frames = 0; a.t = 0; }
  });
  return null;
}
