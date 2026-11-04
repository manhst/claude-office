import { describe, expect, it } from 'vitest';
import type { AgentUI, MessageUI } from '../src/reducer';
import { bubbleFor, lookFor, newFlights, roomWalls, subtitleFor, vpChair, vpGoal, vpHome, vpObstacles, vpPlan, vpStatus, vpVisit, ROOM } from '../src/ref-vanphong/adapter';
import { chuanHoa, MAU_SAN } from '../src/ref-vanphong/characters';
import { blocked, clearLine } from '../src/walk';
import { deskWorld, BUBBLE_MS, DOOR } from '../src/layout';

const ag = (id: string, p: Partial<AgentUI> = {}): AgentUI => ({ id, role: 'coder', name: id, state: 'idle', desk: { x: 0, y: 0 }, tools: [], ...p });

describe('ref-vanphong adapter', () => {
  it('maps every reducer state to a reference status class', () => {
    expect(['idle', 'thinking', 'working', 'talking', 'done', 'error'].map((s) => vpStatus(s as AgentUI['state'])))
      .toEqual(['ranh', 'dang-nghi', 'dang-lam', 'dang-nghe', 'xong', 'loi']);
  });
  it('picks a preset look by role, stable by id for unknown roles', () => {
    expect(lookFor(ag('a', { role: 'Researcher' }))).toBe(MAU_SAN.nu_01);
    expect(lookFor(ag('a', { role: 'coder' }))).toBe(MAU_SAN.nam_01);
    const x = lookFor(ag('zz', { role: 'astronaut' }));
    expect(lookFor(ag('zz', { role: 'astronaut' }))).toBe(x);
    expect(Object.values(MAU_SAN)).toContain(x);
  });
  it('normalises bad appearance data like the reference', () => {
    const n = chuanHoa({ kieu_toc: 'nope', toc: 'red' });
    expect(n.kieu_toc).toBe('ngan'); expect(n.gioi).toBe('nu'); expect(n.toc).toBe('#6b5b95'); expect(n.phu).toBe(n.mat);
    expect(chuanHoa({ kieu_toc: 'nhon' }).gioi).toBe('nam');
  });
  it('bubble: result when done, error when failed, fresh text otherwise, dots while busy', () => {
    const now = 100_000;
    expect(bubbleFor(ag('a', { state: 'done', result: 'R' }), now)).toEqual({ text: 'R', show: true, dots: false });
    expect(bubbleFor(ag('a', { state: 'error', error: 'E' }), now)).toEqual({ text: 'E', show: true, dots: false });
    expect(bubbleFor(ag('a', { state: 'working', text: 'hi', textTs: now - 10 }), now).text).toBe('hi');
    expect(bubbleFor(ag('a', { state: 'idle', text: 'old', textTs: now - BUBBLE_MS - 1 }), now).show).toBe(false);
    expect(bubbleFor(ag('a', { state: 'talking', text: 'old', textTs: now - BUBBLE_MS - 1 }), now).show).toBe(true);
    expect(bubbleFor(ag('a', { state: 'thinking' }), now)).toEqual({ text: '', show: true, dots: true });
  });
  it('subtitle shows the running tool while working', () => {
    expect(subtitleFor(ag('a', { state: 'working', tool: { callId: 'c', name: 'grep', summary: '', ts: 0 } }))).toBe('coder · grep');
    expect(subtitleFor(ag('a', { state: 'done' }))).toBe('coder · done');
  });
  it('seats face +z behind the desk; home and visit spots are walkable', () => {
    const d = { x: 2, y: 1 }, [dx, , dz] = deskWorld(d);
    expect(vpChair(d)).toEqual([dx, 0, dz - 0.62]);
    const obs = vpObstacles();
    for (const desk of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }]) {
      expect(blocked(vpHome(desk)[0], vpHome(desk)[2], obs)).toBe(false);
      expect(blocked(vpVisit(desk)[0], vpVisit(desk)[2], obs)).toBe(false);
    }
  });
  it('agents enter through the room door gap, never through glass', () => {
    const walls = roomWalls();
    const p = vpPlan(DOOR, vpHome({ x: 2, y: 1 }));
    for (let i = 1; i < p.length; i++) expect(clearLine(p[i - 1], p[i], walls)).toBe(true);
    expect(p.some(([x, , z]) => Math.abs(x) < ROOM.door / 2 && Math.abs(z - ROOM.z0) < 0.6)).toBe(true);
  });
  it('goal: home facing +z, or the colleague asked until they reply', () => {
    const agents = { a: ag('a'), b: ag('b', { desk: { x: 1, y: 1 } }) };
    expect(vpGoal(agents.a, agents, [])).toMatchObject({ key: 'home', home: true, face: 0 });
    const ask: MessageUI = { from: 'a', to: 'b', text: 'q', kind: 'ask', ts: 1 };
    const g = vpGoal(agents.a, agents, [ask]);
    expect(g).toMatchObject({ key: 'visit:b', home: false }); expect(g.to).toEqual(vpVisit(agents.b.desk));
    expect(vpGoal(agents.a, agents, [ask, { from: 'b', to: 'a', text: 'r', kind: 'reply', ts: 2 }]).key).toBe('home');
  });
  it('flights: only new messages between known, distinct agents', () => {
    const agents = { a: ag('a'), b: ag('b') };
    const messages: MessageUI[] = [{ from: 'a', to: 'b', text: '', kind: 'ask', ts: 5 }, { from: 'a', to: 'x', text: '', kind: 'ask', ts: 6 }, { from: 'b', to: 'a', text: '', kind: 'reply', ts: 7 }];
    expect(newFlights({ agents, messages }, 0).map((m) => m.ts)).toEqual([5, 7]);
    expect(newFlights({ agents, messages }, 5).map((m) => m.ts)).toEqual([7]);
  });
});
