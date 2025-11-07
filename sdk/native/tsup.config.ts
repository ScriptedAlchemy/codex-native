import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node18",
  shims: false,
  outExtension({ format }) {
    if (format === "cjs") {
      return { js: ".cjs" };
    }
    return { js: ".mjs" };
  },
});
