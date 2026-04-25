import { defineConfig } from "tsup";

// Two builds:
// 1. The default build emits ESM + CJS + dts for `index`, `client`, `server`.
//    `splitting: false` so each entry is a self-contained file (the browser
//    only loads one bundle and the size guard can measure it directly).
// 2. The `noExternal` setting bundles workspace deps into the SDK so consumers
//    only need `@ffp/sdk`.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/entry-client.ts",
    server: "src/entry-server.ts",
    react: "src/entry-react.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  minify: true,
  treeshake: true,
  splitting: false,
  // `react` and `react/jsx-runtime` stay external — declared as an optional
  // peerDep, never inlined into client/server/index bundles.
  external: ["react", "react/jsx-runtime"],
  noExternal: ["@ffp/shared-types", "@ffp/resolver-engine"],
  esbuildOptions(opts, ctx) {
    if (ctx.format === "esm") {
      opts.platform = "neutral";
      opts.mainFields = ["module", "main"];
      opts.conditions = ["module", "import", "browser"];
    }
  },
});
