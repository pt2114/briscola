import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['mac-mini-buddy.taile4c70f.ts.net'],
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4174',
        ws: true,
      },
    },
  },
});
