import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: true
  },
  build: {
    // Sourcemap để debug được production minified errors (vd React error #310).
    // Cost: dist tăng ~30%, deploy chậm hơn vài giây. Worth it.
    sourcemap: true,
  },
})
