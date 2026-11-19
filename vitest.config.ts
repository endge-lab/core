import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    dedupe: ['class-transformer'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    server: { deps: { inline: ['@endge/utils'] } },
    environment: 'node',
    setupFiles: [path.resolve(__dirname, 'src/test/setup.ts')],
  },
})
