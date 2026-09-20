import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['lightweight-charts'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    proxy: { '/api': process.env.REPLAY_API_TARGET || 'http://127.0.0.1:8000' },
  },
});
