# Web (phase 2: 2D office)
```
cd web && npm install && npm test && npm run typecheck
npm run build      # orchestrator then serves it at http://127.0.0.1:7777/#token=… (see orchestrator/.run/ui-url.txt)
npm run dev        # Vite on 127.0.0.1:5173; open http://127.0.0.1:5173/#token=<token>&ws=127.0.0.1:7777
npm run screens    # build + headless Chrome screenshots (1280×800) → docs/screens/phase2-*.png
```
The token is read from the URL fragment, removed from the address bar, kept in sessionStorage for reconnects (exponential backoff, ≤10 s + jitter). `src/reducer.ts` is a pure events → state reducer.
