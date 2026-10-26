import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile } from 'node:fs/promises';

await build({
  configFile: false,
  base: './',
  plugins: [react()],
  define: { 'import.meta.env.VITE_PUBLIC_BUILDER': 'true' },
  build: {
    outDir: 'site-dist',
    minify: false,
    rollupOptions: { input: { editor: 'index.html', automations: 'automations.html' } },
  },
});
await writeFile('site-dist/.nojekyll', '');
