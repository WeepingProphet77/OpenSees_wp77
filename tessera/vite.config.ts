/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves this project site under /<repo>/. Keep the dev server at
// root and only apply the Pages base path for production builds.
const PAGES_BASE = '/OpenSees_wp77/';

// Cache-busting token for the (unhashed) WASM engine files in public/fea. In CI
// this is the commit SHA, so every deploy gets a unique `?v=` and a browser can
// never serve a stale feaEngine.wasm from a previous deploy against new glue.
const ENGINE_VERSION = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  define: {
    __ENGINE_VERSION__: JSON.stringify(ENGINE_VERSION),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
