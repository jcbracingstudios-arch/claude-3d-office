import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const daemon = 'http://127.0.0.1:' + (process.env.CLAUDE_OFFICE_PORT || 7431);

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  // Dev only: `npm run dev` forwards API calls to the local daemon.
  server: { proxy: { '/api': daemon, '/auth': daemon } },
});
