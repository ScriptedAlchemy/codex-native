import { describe, it, expect } from "@jest/globals";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const requireFn = createRequire(import.meta.url);
const distDir = path.join(process.cwd(), "dist");

describe("module format exports", () => {
  it("loads the CommonJS bundle via require", () => {
    const cjsModule = requireFn(path.join(distDir, "index.cjs"));
    expect(cjsModule).toBeDefined();
    expect(typeof cjsModule.Codex).toBe("function");
  });

  it("loads the ESM bundle via dynamic import", async () => {
    const esmPath = path.join(distDir, "index.mjs");
    const esmModule = await import(pathToFileURL(esmPath).href);
    expect(esmModule).toBeDefined();
    expect(typeof esmModule.Codex).toBe("function");
  });
});
