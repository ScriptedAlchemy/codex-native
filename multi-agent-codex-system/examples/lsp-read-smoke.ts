import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { Thread, ThreadEvent } from "@codex-native/sdk";

import { LspDiagnosticsBridge } from "../src/lsp/bridge.js";

class FakeThread {
  private listeners: ((event: ThreadEvent) => void)[] = [];
  public readonly reminders: string[] = [];

  // Minimal surface used by the bridge.
  onEvent(listener: (event: ThreadEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  async sendBackgroundEvent(message: string): Promise<void> {
    this.reminders.push(message);
  }

  emit(event: ThreadEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // placeholder id so bridge's WeakSet can key on it.
  readonly id: string | null = null;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-lsp-read-"));
  try {
    await writeFile(path.join(tempDir, "package-lock.json"), "{}", "utf8");
    const sampleFile = path.join(tempDir, "bad.ts");
    await writeFile(sampleFile, 'const total: number = "oops";\n', "utf8");

    const bridge = new LspDiagnosticsBridge({ workingDirectory: tempDir, waitForDiagnostics: true });
    const thread = new FakeThread();
    bridge.attach(thread as unknown as Thread);

    thread.emit({
      type: "item.completed",
      item: {
        id: "read-file-1",
        type: "mcp_tool_call",
        server: "builtin",
        tool: "read_file",
        arguments: JSON.stringify({ file_path: sampleFile, offset: 1, limit: 200 }),
        status: "completed",
      },
    } as ThreadEvent);

    // Give the bridge a moment to collect diagnostics.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (thread.reminders.length === 0) {
      throw new Error("Expected at least one LSP reminder");
    }
    console.log("Background event:\n", thread.reminders.join("\n---\n"));
    await bridge.dispose();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("LSP read-file smoke failed", error);
  process.exit(1);
});
