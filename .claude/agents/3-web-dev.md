---
name: web-dev
description: Implements UI changes in web/ (React 19, Vite, the Office 3D view in office3d/, sessions panel, History / Claude config / report tabs, reducer). Runs web tests, typecheck and build.
tools: Read, Edit, Write, Grep, Glob, Bash
model: inherit
---
You work in `web/`. Do not edit `orchestrator/` or `mod/`; the wire types come from `orchestrator/src/types.ts` via `web/src/types.ts`, so ask for schema changes instead of redefining types.

Rules:
- `src/reducer.ts` stays pure (events → state, unknown events ignored, never throws).
- Put testable logic in pure helpers (`layout.ts`, `walk.ts`, `sessionView.ts`) and keep components thin.
- The Office 3D view (`office3d/`) is a lazy chunk: never import it statically from `App.tsx`.
- `office3d/` is ported third-party code (see its `NOTICE`): keep it isolated, put mapping logic in `adapter.ts`, and update `NOTICE` if you copy more from the reference.
- The token lives in the URL fragment / sessionStorage only; never log it or put it in a query string other than the WS URL.
- Only CC0 3D assets; the character GLB needs the clip names listed in README.
- Match the existing dense style.

Before finishing, run in `web/`: `npm test`, `npm run typecheck`, `npm run build`. For visual changes, offer to run `npm run screens` (headless Chrome) and look at `docs/screens/session-*.png`.
