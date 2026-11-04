import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Dev server is loopback-only. Production build is served by the orchestrator at http://127.0.0.1:7777/.
export default defineConfig({ plugins: [react()], build: { chunkSizeWarningLimit: 1100 }, // 3D chunk (three+R3F+drei) is lazy-loaded only in 3D view
  server: { host: '127.0.0.1', port: 5173, strictPort: true }, preview: { host: '127.0.0.1', port: 4173 } });
