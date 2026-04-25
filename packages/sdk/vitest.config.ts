import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // React tests opt into happy-dom via a `// @vitest-environment happy-dom`
    // pragma at the top of the file, so the existing node-env client/server
    // tests stay on `node`.
  },
});
