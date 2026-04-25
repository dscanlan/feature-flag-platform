import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    globalSetup: "./test/helpers/global-setup.ts",
  },
});
