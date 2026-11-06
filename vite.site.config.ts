import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Builds the marketing site (site/) into docs/, which GitHub Pages serves.
// It reuses the extension's design tokens and shadcn components from src/, and is
// completely separate from the extension build (vite.config.ts -> dist/).
//   npm run site         dev server
//   npm run site:build   writes docs/
export default defineConfig({
  root: 'site',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: '../docs',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'site/index.html'),
        404: path.resolve(import.meta.dirname, 'site/404.html'),
      },
    },
  },
})
