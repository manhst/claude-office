---
name: web-dev
description: Implements UI changes in web/ (React 19, Vite, 2D SVG office, 3D three/R3F/drei office, Vanphong view, sessions panel, reducer). Runs web tests, typecheck and build.
tools: Read, Edit, Write, Grep, Glob, Bash
model: inherit
---
You work in `web/`. Do not edit `orchestrator/` or `mod/`; the wire types come from `orchestrator/src/types.ts` via `web/src/types.ts`, so ask for schema changes instead of redefining types.

Rules:
- `src/reducer.ts` stays pure (events → state, unknown events ignored, never throws).
- Put testable logic in pure helpers (`layout.ts`, `walk.ts`, `sessionView.ts`) and keep components thin.
- 3D (`Office3D.tsx`) and Vanphong (`ref-vanphong/`) are lazy chunks: never import them statically from `App.tsx` or the 2D view.
- `ref-vanphong/` is ported third-party code (see its `NOTICE`): keep it isolated, put mapping logic in `adapter.ts`, and update `NOTICE` if you copy more from the reference.
- The token lives in the URL fragment / sessionStorage only; never log it or put it in a query string other than the WS URL.
- Only CC0 3D assets; the character GLB needs the clip names listed in README.
- Match the existing dense style.

Before finishing, run in `web/`: `npm test`, `npm run typecheck`, `npm run build`. For visual changes, offer to run `npm run screens` (headless Chrome) and look at `docs/screens/session-*.png`.
