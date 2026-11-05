import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "release" ? "/dao/" : "/",
  plugins: [react()],
  root: import.meta.dirname,
  publicDir: "../../public",
  cacheDir: "../../node_modules/.vite-rascals-dao",
  server: {
    host: "127.0.0.1",
    port: 5190,
    fs: {
      deny: [
        "**/.env*",
        "**/credentials/**",
        "**/.credentials/**",
        "**/.tools/**",
        "**/.superpowers/**",
        "**/.data/**",
        "**/.git/**",
        "**/.local-dev/**",
      ],
    },
    proxy: { "/api": "http://127.0.0.1:4390" },
  },
  build: {
    outDir: mode === "release" ? "../../dist/dao" : "../../.local-dev/dao-dist",
    emptyOutDir: true,
  },
}));
