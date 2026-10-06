import { defineConfig } from 'vite';

export default defineConfig({
  // Mandatory: Snap serves Web Lenses from private/relative schemes
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false, // Keep build size well under 8 MB
    assetsInlineLimit: 4096, // Inline tiny assets, but keep index.html < 1 MB
  },
  server: {
    host: true, // Allow testing on mobile via local network
    port: 3000,
  },
});
