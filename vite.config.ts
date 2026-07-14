import path from 'node:path'

import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['es', 'cjs'],
      name: 'core',
    },
    rollupOptions: {
      external: [
        '@endge/core',
        '@endge/utils',
        '@endge/raph',
        'reflect-metadata',
        'class-transformer',
        'class-validator',
      ],
    },
  },
  plugins: [dts({ rollupTypes: false, tsconfigPath: './tsconfig.json' })],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
