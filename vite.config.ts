import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Must come before react(): it generates src/routeTree.gen.ts from the
    // files in src/routes, so adding a page is just adding a file.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  build: {
    // Förrådet (special-lamp) already serves /assets/* on the same domain.
    // A separate folder keeps the two apps' files from ever colliding.
    assetsDir: 'hem-assets',
  },
  server: { port: 3001 },
});
