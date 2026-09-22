import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built site works under any GitHub Pages path
// (user/repo pages or a project subpath) without per-repo configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
});
