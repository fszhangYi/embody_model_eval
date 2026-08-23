import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, '..')

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/data': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/config': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/models': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/assets': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/vendor': { target: 'http://127.0.0.1:6006', changeOrigin: true },
      '/agent_skills': { target: 'http://127.0.0.1:6006', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(frontendRoot, 'src'),
    },
  },
})
