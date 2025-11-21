import * as path from "node:path";

import type { Diagnostic } from "vscode-languageserver-types";

import { findServerForFile, resolveWorkspaceRoot } from "./servers";
import { LspClient, normalizeSeverity } from "./client";
import type {
  FileDiagnostics,
  LspManagerOptions,
  LspServerConfig,
  NormalizedDiagnostic,
} from "./types";

export class LspManager {
  private clients = new Map<string, Promise<LspClient | null>>();

  constructor(private readonly options: LspManagerOptions) {}

  async collectDiagnostics(files: string[]): Promise<FileDiagnostics[]> {
    const unique = Array.from(new Set(files.map((file) => path.resolve(file))));
    const results: FileDiagnostics[] = [];
    for (const filePath of unique) {
      const server = findServerForFile(filePath);
      if (!server) {
        continue;
      }
      const root = resolveWorkspaceRoot(filePath, server.workspace, this.options.workingDirectory);
      const client = await this.getClient(server, root);
      if (!client) {
        continue;
      }
      try {
        await client.openFile(filePath, this.options.waitForDiagnostics !== false);
      } catch (error) {
        console.warn(`[lsp] failed to open ${filePath}:`, error);
        continue;
      }
      const normalized = client
        .getDiagnostics(filePath)
        .map((diag) => normalizeDiagnostic(diag))
        .filter((diag) => diag.message.trim().length > 0);
      if (normalized.length > 0) {
        results.push({ path: filePath, diagnostics: normalized });
      }
    }
    return results;
  }

  async dispose(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.values()).map(async (promise) => {
        const client = await promise;
        await client?.shutdown();
      }),
    );
    this.clients.clear();
  }

  private async getClient(server: LspServerConfig, root: string): Promise<LspClient | null> {
    const key = `${server.id}:${root}`;
    let existing = this.clients.get(key);
    if (!existing) {
      existing = this.createClient(server, root);
      this.clients.set(key, existing);
    }
    const client = await existing;
    if (!client) {
      this.clients.delete(key);
    }
    return client;
  }

  private async createClient(server: LspServerConfig, root: string): Promise<LspClient | null> {
    try {
      return await LspClient.start(server, root);
    } catch (error) {
      console.warn(`[lsp] unable to start ${server.displayName}:`, error);
      return null;
    }
  }
}

function normalizeDiagnostic(diag: Diagnostic): NormalizedDiagnostic {
  return {
    message: diag.message ?? "",
    severity: normalizeSeverity(diag.severity),
    source: diag.source,
    code: diag.code,
    range: diag.range,
  };
}

