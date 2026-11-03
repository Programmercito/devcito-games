import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://games.devcito.org',
  outDir: './docs',
  // The toolbar pill overlaps the game HUD (log line + confirm button).
  devToolbar: { enabled: false },
});
