import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration tests share one Postgres database and reset its schema in
    // beforeAll. Run files serially so they don't race.
    fileParallelism: false,
  },
});
