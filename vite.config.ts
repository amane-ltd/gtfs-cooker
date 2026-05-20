import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/gtfs-cooker/',
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
});
