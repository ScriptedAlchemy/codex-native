import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { createMessageConnection, type MessageConnection } from "vscode-jsonrpc";
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/lib/node/main.js";
import type { Diagnostic } from "vscode-languageserver-types";
import { DiagnosticSeverity } from "vscode-languageserver-types";

import type { LspServerConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 3_000;

export class LspClient {
  private connection: MessageConnection | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private diagnostics = new Map<string, Diagnostic[]>();
  private versions = new Map<string, number>();
  private emitter = new EventEmitter();

  private constructor(
    private readonly config: LspServerConfig,
    private readonly root: string,
  ) {}

  static async start(server: LspServerConfig, root: string): Promise<LspClient> {
    const client = new LspClient(server, root);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    const [command, ...args] = this.config.command;
    if (!command) {
      throw new Error(`LSP server ${this.config.id} is missing a command executable`);
    }
    try {
      this.process = spawn(command, args, {
        cwd: this.root,
        env: { ...process.env, ...this.config.env },
        stdio: "pipe",
      });
    } catch (error) {
      throw new Error(`Failed to spawn ${this.config.displayName} (${command}): ${String(error)}`);
    }

    const child = this.process;
    // LSP stderr is suppressed from console - agents still get diagnostics via publishDiagnostics
    child.stderr.on("data", (_chunk) => {
      // Silently consume stderr to avoid console spam during merge resolution
    });

    const reader = new StreamMessageReader(child.stdout);
    const writer = new StreamMessageWriter(child.stdin);
    this.connection = createMessageConnection(reader, writer);

    this.connection.onNotification("textDocument/publishDiagnostics", (payload: PublishDiagnosticsParams) => {
      const fsPath = fileURLToPath(payload.uri);
      this.diagnostics.set(fsPath, payload.diagnostics);
      this.emitter.emit(`diagnostics:${fsPath}`);
    });
    this.connection.onError((err: unknown) => {
      console.warn(`[lsp:${this.config.id}] connection error`, err);
    });
    this.connection.listen();

    await this.connection.sendRequest("initialize", {
      rootUri: pathToFileURL(this.root).href,
      processId: process.pid,
      initializationOptions: this.config.initializationOptions ?? {},
      capabilities: {
        textDocument: {
          synchronization: {
            didOpen: true,
            didChange: true,
          },
          publishDiagnostics: {
            versionSupport: true,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          name: path.basename(this.root),
          uri: pathToFileURL(this.root).href,
        },
      ],
    });
    await this.connection.sendNotification("initialized", {});
  }

  async openFile(filePath: string, waitForDiagnostics: boolean): Promise<void> {
    if (!this.connection) return;
    const absolute = path.resolve(filePath);
    const text = await fs.readFile(absolute, "utf8");
    const uri = pathToFileURL(absolute).href;
    const languageId = detectLanguageId(absolute);

    const existingVersion = this.versions.get(absolute);
    if (existingVersion === undefined) {
      this.versions.set(absolute, 0);
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 0,
          text,
        },
      });
    } else {
      const next = existingVersion + 1;
      this.versions.set(absolute, next);
      await this.connection.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version: next,
        },
        contentChanges: [{ text }],
      });
    }

    if (waitForDiagnostics) {
      await this.waitForDiagnostics(absolute);
    }
  }

  getDiagnostics(filePath: string): Diagnostic[] {
    const absolute = path.resolve(filePath);
    return this.diagnostics.get(absolute) ?? [];
  }

  private waitForDiagnostics(filePath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const absolute = path.resolve(filePath);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs).unref();
      this.emitter.once(`diagnostics:${absolute}`, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.connection?.dispose();
    } catch {
      // ignore
    }
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
}

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: Diagnostic[];
};

function detectLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".py":
    case ".pyi":
      return "python";
    case ".rs":
      return "rust";
    default:
      return "plaintext";
  }
}

export function normalizeSeverity(severity?: Diagnostic["severity"]): "error" | "warning" | "info" | "hint" {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
      return "info";
    case DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "error";
  }
}
