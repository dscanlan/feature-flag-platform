import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sidecarPort } from "../e2e-stack/src/constants.ts";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      "/sidecar": {
        target: `http://127.0.0.1:${sidecarPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sidecar/, ""),
      },
      "/resolver": {
        target: "http://127.0.0.1:4101",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/resolver/, ""),
      },
    },
  },
});
