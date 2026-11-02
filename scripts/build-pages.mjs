import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile } from 'node:fs/promises';
import {buildStudioTemplates} from './build-studio-templates.mjs';

await build({
  configFile: false,
  base: './',
  plugins: [react()],
  define: { 'import.meta.env.VITE_PUBLIC_BUILDER': 'true' },
  build: {
    outDir: 'site-dist',
    minify: false,
    rollupOptions: { input: { editor: 'index.html', legacy:'legacy.html', preview:'studio/scene-preview.html', fullEditor:'studio/full-editor.html', events:'studio/automations.html', testRoom: 'test-room.html', community:'community.html' } },
  },
});
await writeFile('site-dist/.nojekyll', '');
await buildStudioTemplates('site-dist/studio');
