import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true
  },
  build: {
    outDir: resolve(__dirname, 'web-dist'),
    emptyOutDir: true
  }
})
