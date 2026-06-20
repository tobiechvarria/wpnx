import { defineConfig } from 'astro/config';

// Pure static output — no adapter needed for Cloudflare Pages static hosting
export default defineConfig({
  output: 'static',
  site: 'https://wpnx.pages.dev',
});
