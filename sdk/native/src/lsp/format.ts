import * as path from "node:path";

import type { FileDiagnostics } from "./types";

const MAX_DIAGNOSTICS_PER_FILE = 5;

export function formatDiagnosticsForTool(diagnostics: FileDiagnostics[]): string {
  return diagnostics
    .map(({ path: filePath, diagnostics: entries }) => {
      const rel = filePath;
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

export function formatDiagnosticsForBackgroundEvent(
  diagnostics: FileDiagnostics[],
  cwd: string,
): string {
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

