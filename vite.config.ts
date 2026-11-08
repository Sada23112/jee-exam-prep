import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\\\', '/')
          if (path.includes('/katex/')) return 'math-renderer'
          if (path.includes('/pdfjs-dist/')) return 'pdf-worker'
          if (path.includes('/dexie/')) return 'local-database'
          if (path.includes('/zod/')) return 'validation'
          if (path.includes('/react/') || path.includes('/react-dom/') || path.includes('/react-router') || path.includes('/scheduler/')) return 'react-vendor'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
})
