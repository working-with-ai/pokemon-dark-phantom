import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  publicDir: '.cloudflare-public',
  plugins: [cloudflare()],
  server: { port: 8788 }
});
