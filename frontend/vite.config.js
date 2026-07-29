import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Port 3000 is not the Vite default (5173) — it is pinned here to match the
 * backend's CORS_ORIGIN. Changing one without the other breaks every request
 * with an opaque CORS error, so keep them in step.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
