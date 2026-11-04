import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Dev server is loopback-only. Production build is served by the orchestrator at http://127.0.0.1:7777/.
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true }, preview: { host: '127.0.0.1', port: 4173 } });
