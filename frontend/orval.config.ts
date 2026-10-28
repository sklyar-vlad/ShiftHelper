import { defineConfig } from "orval";

const input = "../docs/openapi.yaml";

export default defineConfig({
  api: {
    input,
    output: {
      target: "src/shared/api/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      formatter: "prettier",
      override: {
        mutator: { path: "src/shared/api/http.ts", name: "http" },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  zod: {
    input,
    output: {
      target: "src/shared/api/generated/zod.ts",
      client: "zod",
      formatter: "prettier",
    },
  },
});
