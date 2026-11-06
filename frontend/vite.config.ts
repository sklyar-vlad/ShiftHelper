import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const api = process.env.API_URL ?? "http://localhost:8081";
const swagger = process.env.SWAGGER_URL ?? "http://localhost:8080";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Dev server mirrors frontend/nginx.conf: docs come from the swagger container, the rest of /api from the backend.
  plugins: [
    {
      name: "docs-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/api/v1/docs") return next();
          res.writeHead(302, { Location: "/docs/swagger.html" }).end();
        });
      },
    },
  ],
  test: { environment: "happy-dom" },
  server: {
    proxy: {
      "/api/v1/openapi.yaml": {
        target: swagger,
        rewrite: () => "/openapi.yaml",
      },
      "/docs": {
        target: swagger,
        rewrite: (path) => path.replace(/^\/docs/, ""),
      },
      "/api": api,
      "/healthz": api,
      "/readyz": api,
    },
  },
});
