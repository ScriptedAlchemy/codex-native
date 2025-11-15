import type { Diagnostic } from "vscode-languageserver-types";

export type LspDiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type NormalizedDiagnostic = {
  message: string;
  severity: LspDiagnosticSeverity;
  source?: string;
  code?: string | number;
  range: Diagnostic["range"];
};

export type FileDiagnostics = {
  path: string;
  diagnostics: NormalizedDiagnostic[];
};

export type WorkspaceLocator =
  | {
      type: "markers";
      include: string[];
      exclude?: string[];
    }
  | {
      type: "fixed";
      path: string;
    };

export type LspServerConfig = {
  id: string;
  displayName: string;
  command: string[];
  extensions: string[];
  env?: NodeJS.ProcessEnv;
  initializationOptions?: Record<string, unknown>;
  workspace?: WorkspaceLocator;
};

export type LspManagerOptions = {
  workingDirectory: string;
  waitForDiagnostics?: boolean;
};

