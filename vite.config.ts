import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // Keep the live dependency optimizer separate from verification servers.
  cacheDir: "node_modules/.vite-rascals-dev",
  plugins: [
    {
      name: "deny-private-runtime-paths",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          let path = (req.url ?? "/").split("?")[0];
          try {
            for (let n = 0; n < 3; n++) {
              const decoded = decodeURIComponent(path);
              if (decoded === path) break;
              path = decoded;
            }
          } catch {
            res.statusCode = 403;
            return res.end("Forbidden");
          }
          if (
            path
              .split(/[\\/]/)
              .some(
                (part) =>
                  [
                    ".local-dev",
                    ".credentials",
                    ".data",
                    ".tools",
                    ".superpowers",
                    ".git",
                  ].includes(part) || part.startsWith(".env"),
              ) ||
            /\.(?:crt|pem|key)$/i.test(path)
          ) {
            res.statusCode = 403;
            return res.end("Forbidden");
          }
          next();
        });
      },
    },
    react(),
  ],
  // The cage is lazy-loaded. Prebundle both renderer dependencies up front so
  // late discovery cannot invalidate their optimizer URLs after first render.
  optimizeDeps: { include: ["three", "cannon-es"] },
  server: {
    port: 5177,
    host: "127.0.0.1",
    fs: {
      strict: true,
      deny: [
        "**/.local-dev/**",
        "**/.credentials/**",
        "**/.data/**",
        "**/.tools/**",
        "**/.superpowers/**",
        "**/.env*",
        "**/.git/**",
        "**/*.{crt,pem,key}",
      ],
    },
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
  build: { outDir: "dist/web" },
});
