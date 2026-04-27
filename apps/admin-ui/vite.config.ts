import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.ADMIN_UI_PORT ?? 5173),
    // ADMIN_UI_HOST lets the e2e suite force IPv4 (127.0.0.1) so Playwright
    // doesn't get a connection-refused when Node's getaddrinfo returns ::1
    // first — the default `localhost` binds IPv6-only on some macOS configs.
    host: process.env.ADMIN_UI_HOST ?? "localhost",
    proxy: {
      "/api": {
        // Override via ADMIN_API_PROXY_TARGET so the e2e suite can route /api
        // at the e2e-stack admin-api on a non-default port without forking
        // this config.
        target: process.env.ADMIN_API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
