import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: process.env.VITE_BASE || '/',
  build: { outDir: 'dist', target: 'es2020', sourcemap: false },
  server: { port: 5173, host: true },
  test: { include: ['tests/**/*.test.ts'] },
});
