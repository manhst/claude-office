import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls, PerformanceMonitor, QuadraticBezierLine, RoundedBox } from '@react-three/drei';
import { Color, type Group, type MeshStandardMaterial } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { AgentUI, MessageUI, OfficeState } from './reducer';
import { BUBBLE_MS, DOOR, MSG_MS, SEAT_OFFSET, STATE_COLORS, add, allDesks, avatarTarget, clampTarget, damp, damp3, deskWorld, type Vec3 } from './layout';
import { ToolChip } from './Office2D';
import { IconCheck, IconMail, IconReply } from './icons';

/** Software rasterisers (SwiftShader/llvmpipe, e.g. headless CI) can't afford MSAA at 60fps; detect once. */
const SOFTWARE_GL = (() => { try { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info');
  return /swiftshader|llvmpipe|software/i.test(e ? String(c!.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''); } catch { return false; } })();

export default function Office3D({ s, now }: { s: OfficeState; now: number }) {
  const [fps, setFps] = useState(0);
  const [dpr, setDpr] = useState(SOFTWARE_GL ? 1 : 1.5);
  const agents = s.order.map((id) => s.agents[id]).filter(Boolean);
  const live = s.messages.filter((m) => now - m.ts < MSG_MS && s.agents[m.from] && s.agents[m.to]);
  return (
    <section className="stage3d" data-testid="office3d">
      <Canvas camera={{ position: [0, 8.5, 11], fov: 45 }} dpr={dpr} gl={{ antialias: !SOFTWARE_GL, powerPreference: 'high-performance' }}>
        <color attach="background" args={['#0f172a']} />
        <hemisphereLight args={['#c7d2fe', '#0f172a', 0.9]} />
        <directionalLight position={[6, 10, 4]} intensity={1.4} />
        <Floor />
        {allDesks().map((d, i) => <Desk key={i} pos={deskWorld(d)} occupied={agents.some((a) => a.desk.x === d.x && a.desk.y === d.y)} />)}
        {agents.map((a) => <Avatar key={a.id} a={a} s={s} now={now} />)}
        {live.map((m, i) => <MessageArc key={`${m.ts}-${i}`} m={m} s={s} />)}
        <Controls />
        <FpsMeter onFps={setFps} />
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} flipflops={3} onFallback={() => setDpr(1)} />
      </Canvas>
      <div className="hud" data-testid="fps">{fps} fps</div>
      {!agents.length && <div className="hud hud-center">Waiting for agents…</div>}
    </section>
  );
}
function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}><planeGeometry args={[20, 16]} /><meshStandardMaterial color="#1a2742" /></mesh>
      <gridHelper args={[20, 20, '#2b3b5c', '#22304d']} position={[0, 0, 0]} />
      <mesh position={[0, 1.2, -8]}><boxGeometry args={[20, 2.4, 0.2]} /><meshStandardMaterial color="#16213a" /></mesh>
      <mesh position={[DOOR[0], 1, -7.85]}><boxGeometry args={[1.6, 2, 0.1]} /><meshStandardMaterial color="#334155" /></mesh>
    </group>
  );
}
function Desk({ pos, occupied }: { pos: Vec3; occupied: boolean }) {
  return (
    <group position={pos}>
      <RoundedBox args={[2.6, 0.12, 1.2]} radius={0.04} position={[0, 0.75, 0]}><meshStandardMaterial color={occupied ? '#64748b' : '#475569'} /></RoundedBox>
      {[[-1.15, -0.5], [1.15, -0.5], [-1.15, 0.5], [1.15, 0.5]].map(([x, z], i) => <mesh key={i} position={[x, 0.37, z]}><boxGeometry args={[0.08, 0.74, 0.08]} /><meshStandardMaterial color="#334155" /></mesh>)}
      <mesh position={[0, 1.15, -0.35]}><boxGeometry args={[0.9, 0.55, 0.05]} /><meshStandardMaterial color="#0b1220" emissive={occupied ? '#1e3a8a' : '#000000'} emissiveIntensity={0.6} /></mesh>
    </group>
  );
}
function Avatar({ a, s, now }: { a: AgentUI; s: OfficeState; now: number }) {
  const g = useRef<Group>(null); const mat = useRef<MeshStandardMaterial>(null); const body = useRef<Group>(null);
  const pos = useRef<Vec3>([...DOOR]); const target = useMemo(() => new Color(), []);
  const goal = avatarTarget(a, s.agents, s.messages, now);
  useFrame((st, dt) => {
    const d = Math.min(dt, 0.1);
    pos.current = damp3(pos.current, goal, 4, d);
    g.current?.position.set(pos.current[0], pos.current[1], pos.current[2]);
    if (mat.current) { target.set(STATE_COLORS[a.state]); mat.current.color.lerp(target, 1 - Math.exp(-6 * d)); mat.current.emissive.copy(mat.current.color).multiplyScalar(0.25); }
    if (body.current) {
      const t = st.clock.elapsedTime;
      const bob = a.state === 'working' ? Math.abs(Math.sin(t * 10)) * 0.06 : a.state === 'thinking' ? Math.sin(t * 3) * 0.05 : 0;
      body.current.position.y = damp(body.current.position.y, 0.75 + bob, 12, d);
    }
  });
  const showBubble = a.text && a.textTs && (now - a.textTs < BUBBLE_MS || a.state === 'talking');
  return (
    <group ref={g}>
      <group ref={body} position={[0, 0.75, 0]}>
        <mesh><capsuleGeometry args={[0.35, 0.7, 8, 16]} /><meshStandardMaterial ref={mat} color={STATE_COLORS[a.state]} roughness={0.45} /></mesh>
        <mesh position={[0, 0.2, -0.33]}><boxGeometry args={[0.36, 0.1, 0.05]} /><meshStandardMaterial color="#0f172a" /></mesh>
      </group>
      <Html position={[0, 2.0, 0]} center zIndexRange={[20, 0]} className="h3-wrap">
        <div className="h3" data-state={a.state} data-testid={`agent3d-${a.role}`}>
          {showBubble && <div className="bubble bubble3d">{a.text}</div>}
          <div className="name3d">{a.name} <small>{a.state}</small></div>
          <ToolChip a={a} />
          {a.state === 'done' && a.result && <div className="result result3d"><IconCheck size={12} /><span className="clamp">{a.result}</span></div>}
        </div>
      </Html>
    </group>
  );
}
function MessageArc({ m, s }: { m: MessageUI; s: OfficeState }) {
  const fromDesk = s.agents[m.from].desk, toDesk = s.agents[m.to].desk;
  // memoised so the Line2 geometry is not rebuilt on every 250ms UI tick
  const { a, b, mid } = useMemo(() => {
    const a = add(add(deskWorld(fromDesk), SEAT_OFFSET), [0, 1.6, 0]);
    const b = add(add(deskWorld(toDesk), SEAT_OFFSET), [0, 1.6, 0]);
    const mid: Vec3 = [(a[0] + b[0]) / 2, 3.0 + (m.kind === 'reply' ? 0.5 : 0), (a[2] + b[2]) / 2];
    return { a, b, mid };
  }, [fromDesk.x, fromDesk.y, toDesk.x, toDesk.y, m.kind]);
  const ref = useRef<any>(null);
  useFrame((_, dt) => { if (ref.current?.material) ref.current.material.dashOffset -= dt * 2; });
  return (
    <group>
      <QuadraticBezierLine ref={ref} start={a} end={b} mid={mid} color={m.kind === 'reply' ? '#4ade80' : '#38bdf8'} lineWidth={3} dashed dashSize={0.3} gapSize={0.2} />
      <Html position={[mid[0], mid[1] * 0.8, mid[2] + 0.4]} center zIndexRange={[30, 10]}>
        <div className={`envelope env-${m.kind} env3d`} data-testid="msg-card3d">{m.kind === 'ask' ? <IconMail /> : <IconReply />}<span>{m.text}</span></div>
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
