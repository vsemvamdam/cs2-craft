import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /cs2-craft/
export default defineConfig({
  base: process.env.BASE_PATH || '/cs2-craft/',
  plugins: [react()],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
