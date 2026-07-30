import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration.
 *
 * SINGLE ORIGIN. The app is served on one host and `/api` is proxied to the
 * Express server, rather than the browser talking to two origins. That means:
 *
 *   - no CORS preflights, because every request is same-origin
 *   - the httpOnly `SameSite=Strict` refresh cookie works without exception
 *   - the frontend never hardcodes the API host, so the same build runs on
 *     medchain.local, localhost, or a LAN address with no rebuild
 *
 * Port 80 keeps the URL clean: http://medchain.local rather than :3000.
 * Windows permits binding low ports without elevation.
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 80,
    strictPort: true,
    // Listen on all interfaces so medchain.local and LAN devices both resolve.
    host: true,
    allowedHosts: ["medchain.local", "www.medchain.local", "localhost", "127.0.0.1"],

    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
        // The backend already serves under /api/v1, so no path rewrite.
      },
    },
  },

  preview: {
    port: 80,
    strictPort: true,
    host: true,
    allowedHosts: ["medchain.local", "www.medchain.local", "localhost"],
    proxy: {
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: false },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
