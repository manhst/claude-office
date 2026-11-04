/** Token handling: read once from the URL fragment (never sent to servers or logged), strip it from the address bar, keep in sessionStorage for reconnects. */
export function takeToken(loc: Location = location, store: Storage = sessionStorage): { token: string | null; wsUrl: string } {
  const h = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const fromHash = h.get('token');
  if (fromHash) { store.setItem('office.token', fromHash); if (h.get('ws')) store.setItem('office.ws', h.get('ws')!); history.replaceState(null, '', loc.pathname + loc.search); }
  const hostPort = store.getItem('office.ws') ?? (loc.port === '5173' || loc.port === '4173' ? '127.0.0.1:7777' : loc.host);
  return { token: fromHash ?? store.getItem('office.token'), wsUrl: `ws://${hostPort}/ws` };
}
export function backoffMs(attempt: number, rand = Math.random) { return Math.round(Math.min(10_000, 500 * 2 ** attempt) * (0.75 + rand() * 0.5)); }
export function connect(wsUrl: string, token: string, onEvent: (e: unknown) => void, onStatus: (s: 'connecting' | 'open' | 'reconnecting', retries: number) => void) {
  let ws: WebSocket | null = null, attempt = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    onStatus(attempt ? 'reconnecting' : 'connecting', attempt);
    ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { attempt = 0; onStatus('open', 0); };
    ws.onmessage = (m) => { try { onEvent(JSON.parse(String(m.data))); } catch { /* ignore malformed frame */ } };
    ws.onclose = () => { if (stopped) return; const d = backoffMs(attempt++); onStatus('reconnecting', attempt); timer = setTimeout(open, d); };
  };
  open();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
