import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'http://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
});
