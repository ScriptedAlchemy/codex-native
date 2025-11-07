import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node18",
  shims: true,
  external: [
    "@openai/agents",
    "@openai/agents-core",
    "@openai/agents-openai",
    "@openai/agents-realtime",
    "debug",
  ],
  outExtension({ format }) {
    if (format === "cjs") {
      return { js: ".cjs" };
    }
    return { js: ".mjs" };
  },
});
