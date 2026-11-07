import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/client",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./public", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 8013,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8003",
      "/ws": { target: "ws://127.0.0.1:8003", ws: true },
    },
  },
});
