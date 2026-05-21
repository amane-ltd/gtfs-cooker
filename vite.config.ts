import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/gtfs-cooker/',
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  resolve: {
    dedupe: [
      '@deck.gl/core',
      '@luma.gl/core',
      '@luma.gl/engine',
      '@luma.gl/shadertools',
      '@luma.gl/webgl',
    ],
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', 'apache-arrow'],
    include: [
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/mapbox',
      '@deck.gl/geo-layers',
      '@luma.gl/core',
      '@luma.gl/engine',
      '@luma.gl/shadertools',
      '@luma.gl/webgl',
    ],
  },
});
