import { build } from 'vite';
import react from '@vitejs/plugin-react';

// Separate from the Twitch package. Never replace its submitted assets here.
await build({
  configFile: false,
  plugins: [react()],
  build: {
    outDir: 'outputs/automation-preview-build',
    rollupOptions: { input: 'automations.html' },
  },
});
