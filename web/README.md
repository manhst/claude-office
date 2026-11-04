# Web (phase 2: 2D office)
```
cd web && npm install && npm test && npm run typecheck
npm run build      # orchestrator then serves it at http://127.0.0.1:7777/#token=… (see orchestrator/.run/ui-url.txt)
npm run dev        # Vite on 127.0.0.1:5173; open http://127.0.0.1:5173/#token=<token>&ws=127.0.0.1:7777
npm run screens    # phase-2 screenshots → docs/screens/phase2-*.png
npm run screens3   # phase-3: 2D + 3D screenshots, overlap/emoji/camera checks, fps sampling (SwiftShader) → docs/screens/phase3-*.png
```
The token is read from the URL fragment, removed from the address bar, kept in sessionStorage for reconnects (exponential backoff, ≤10 s + jitter). `src/reducer.ts` is a pure events → state reducer.

Phase 3: header toggle 2D/3D (persisted in localStorage `office.view`). The 3D view (`src/Office3D.tsx`, three + @react-three/fiber + drei) is a lazy chunk, loaded only when 3D is selected. Pure layout/lerp/camera-clamp logic lives in `src/layout.ts`.
