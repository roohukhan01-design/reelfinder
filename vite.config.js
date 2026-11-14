import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// GramJS (the "telegram" package) needs Node helpers like Buffer inside the WebView.
export default defineConfig({
  base: './',
  plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true })],
  build: { outDir: 'www', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 4000 }
});
