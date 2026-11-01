import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    minify: false,
    rollupOptions: {
      input: {
        config: resolve("config.html"),
        viewer: resolve("viewer.html"),
        automations: resolve("automations.html"),
        mobile: resolve("mobile.html"),
      },
    },
  },
});
