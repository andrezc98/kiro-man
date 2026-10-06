import { defineConfig } from 'vite';

// Relative base so the same build works from `vite preview`, S3 + CloudFront, or a sub-path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
