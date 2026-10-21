import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
  server: {
    // Forward API calls to the NestJS dev server.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
