import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the viewer page into dist/. Everything in public/ (manifest.json,
// background.js, icons/) is copied to dist/ untouched, so dist/ is the
// unpacked extension to load in Chrome.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { viewer: path.resolve(import.meta.dirname, 'viewer.html') },
    },
  },
})
