import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: { port: 5175, strictPort: false },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tutorial: resolve(__dirname, 'tutorial.html'),
      },
    },
  },
})
