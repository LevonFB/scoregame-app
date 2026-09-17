import { defineConfig } from "vitest/config";

// Integration tests that boot a local D1 via getPlatformProxy. Heavier than the
// unit suite, so they run separately (`pnpm test:int`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.inttest.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
