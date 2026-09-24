import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@raphy-js/raph': path.resolve(__dirname, '../@raphy/@raphy-raph/dist/raph.js'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [path.resolve(__dirname, 'src/test/setup.ts')],
  },
})
