import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration.
 *
 * PORT 3000 is the contract with the rest of the project: the README, the
 * installation guide and the backend's CORS_ORIGIN all name it. It is pinned
 * with strictPort so a port clash fails loudly at startup instead of silently
 * moving the app to 3001, which would leave http://localhost:3000 dead with no
 * error to explain why.
 *
 * SINGLE ORIGIN: `/api` is proxied to the Express server rather than the
 * browser talking to two origins. That gives:
 *   - no CORS preflights, because every request is same-origin
 *   - the httpOnly SameSite=Strict refresh cookie works with no special cases
 *   - VITE_API_URL stays relative, so no host is baked into the build
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 3000,
    strictPort: true,
    // Listen on all interfaces so phones on the LAN can reach the dev server.
    host: true,
    // Vite blocks unknown Host headers; these are the names we serve under.
    allowedHosts: ["localhost", "127.0.0.1", "medchain.local", "www.medchain.local"],

    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
        // The backend already serves under /api/v1, so no path rewrite.
      },
    },
  },

  preview: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: ["localhost", "127.0.0.1", "medchain.local", "www.medchain.local"],
    proxy: {
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: false },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
