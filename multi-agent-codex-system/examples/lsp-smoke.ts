import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { LspManager } from "../src/lsp/manager.js";

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-lsp-smoke-"));
  try {
    await writeFile(path.join(tempDir, "package-lock.json"), "{}", "utf8");
    const sampleFile = path.join(tempDir, "broken.ts");
    await writeFile(sampleFile, 'const value: number = "oops";\n', "utf8");

    const manager = new LspManager({
      workingDirectory: tempDir,
      waitForDiagnostics: true,
    });
    const diagnostics = await manager.collectDiagnostics([sampleFile]);
    console.log(JSON.stringify(diagnostics, null, 2));
    await manager.dispose();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("LSP smoke test failed", error);
  process.exit(1);
});
