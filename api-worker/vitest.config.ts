import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // E2E suites under e2e/ use node:test (run via `pnpm test:e2e`), not vitest.
    // *.inttest.ts spin up a local D1 (getPlatformProxy) → run via `pnpm test:int`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/*.inttest.ts"],
  },
  resolve: {
    alias: {},
  },
});
