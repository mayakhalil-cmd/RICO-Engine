import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The interface is served by RICO itself from the "ui" folder, so every
// path is relative and nothing is loaded from the internet.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  server: { port: 5174 },
})
