import * as path from "node:path";

import type { Thread, ThreadItem } from "@codex-native/sdk";

import { LspManager } from "./manager.js";
import type { FileDiagnostics, LspManagerOptions } from "./types.js";

const MAX_DIAGNOSTICS_PER_FILE = 5;

export class LspDiagnosticsBridge {
  private readonly manager: LspManager;
  private readonly attached = new WeakSet<Thread>();

  constructor(private readonly options: LspManagerOptions) {
    this.manager = new LspManager(options);
  }

  attach(thread: Thread): () => void {
    if (this.attached.has(thread)) {
      return () => {};
    }
    this.attached.add(thread);
    const unsubscribe = thread.onEvent((event) => {
      if (event.type !== "item.completed") {
        return;
      }

      if (event.item.type === "file_change") {
        const targets = event.item.changes
          .filter((change) => change.kind !== "delete")
          .map((change) => path.resolve(this.options.workingDirectory, change.path));
        if (targets.length === 0) {
          return;
        }
        void this.processDiagnostics(thread, targets);
        return;
      }

      if (event.item.type === "mcp_tool_call") {
        const targets = extractReadFileTargets(event.item, this.options.workingDirectory);
        if (targets.length === 0) {
          return;
        }
        void this.processDiagnostics(thread, targets);
      }
    });
    return () => {
      this.attached.delete(thread);
      unsubscribe();
    };
  }

  async dispose(): Promise<void> {
    await this.manager.dispose();
  }

  private async processDiagnostics(thread: Thread, files: string[]): Promise<void> {
    try {
      const diagnostics = await this.manager.collectDiagnostics(files);
      if (diagnostics.length === 0) {
        return;
      }
      const summary = formatDiagnostics(diagnostics, this.options.workingDirectory);
      console.log(`\n📟 LSP diagnostics detected:\n${summary}\n`);
      try {
        await thread.sendBackgroundEvent(`LSP diagnostics detected:\n${summary}`);
      } catch {
        // Thread may have ended; ignore.
      }
    } catch (error) {
      console.warn("[lsp] failed to collect diagnostics", error);
    }
  }
}

function formatDiagnostics(diagnostics: FileDiagnostics[], cwd: string): string {
  return diagnostics
    .map(({ path: filePath, diagnostics: entries }) => {
      const rel = path.relative(cwd, filePath) || filePath;
      const lines = entries.slice(0, MAX_DIAGNOSTICS_PER_FILE).map((diag) => {
        const { line, character } = diag.range.start;
        const location = `${line + 1}:${character + 1}`;
        const source = diag.source ? ` · ${diag.source}` : "";
        return `  - [${diag.severity.toUpperCase()}] ${diag.message} (${location}${source})`;
      });
      const trimmed = entries.length > MAX_DIAGNOSTICS_PER_FILE ? "  - …" : "";
      return [`• ${rel}`, ...lines, trimmed].filter(Boolean).join("\n");
    })
    .join("\n");
}

function extractReadFileTargets(item: ThreadItem, cwd: string): string[] {
  if (item.type !== "mcp_tool_call") {
    return [];
  }
  const toolName = item.tool?.toLowerCase?.();
  if (toolName !== "read_file" && toolName !== "read_file_v2") {
    return [];
  }

  let args: unknown = item.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return [];
    }
  }

  if (!args || typeof args !== "object") {
    return [];
  }

  const filePath = (args as { file_path?: unknown; path?: unknown }).file_path ??
    (args as { path?: unknown }).path;
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    return [];
  }

  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  return [resolved];
}
