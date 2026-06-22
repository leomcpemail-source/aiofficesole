import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 3333,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3334',
        ws: true,
      },
    },
  },
  // Harden the production bundle: minified, no sourcemaps, strip console/debugger.
  build: {
    sourcemap: false,
  },
  esbuild: mode === 'production'
    ? { drop: ['console', 'debugger'], legalComments: 'none' }
    : {},
}))
