import path from 'node:path'

import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['es'],
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
  plugins: [dts({
    bundleTypes: false,
    exclude: ['src/test/**'],
    tsconfigPath: './tsconfig.json',
  })],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
