import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.REEL_SERVER ?? 'http://127.0.0.1:5180';
const proxy = Object.fromEntries(['/api', '/files', '/preview'].map((p) => [p, { target: server, changeOrigin: false }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
