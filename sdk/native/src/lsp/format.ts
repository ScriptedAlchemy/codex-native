import * as path from "node:path";

import type { FileDiagnostics, NormalizedDiagnostic } from "./types";

const MAX_DIAGNOSTICS_PER_FILE = 5;

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

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

/**
 * Filter diagnostics by minimum severity level
 */
export function filterBySeverity(
  diagnostics: FileDiagnostics[],
  minSeverity: DiagnosticSeverity = "error",
): FileDiagnostics[] {
  const severityOrder: Record<DiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
    hint: 3,
  };
  const threshold = severityOrder[minSeverity];

  return diagnostics
    .map((file) => ({
      ...file,
      diagnostics: file.diagnostics.filter(
        (diag) => severityOrder[diag.severity as DiagnosticSeverity] <= threshold,
      ),
    }))
    .filter((file) => file.diagnostics.length > 0);
}

/**
 * Generate summary statistics for diagnostics
 */
export function summarizeDiagnostics(diagnostics: FileDiagnostics[]): {
  fileCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
  totalCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let hintCount = 0;

  for (const file of diagnostics) {
    for (const diag of file.diagnostics) {
      switch (diag.severity) {
        case "error":
          errorCount++;
          break;
        case "warning":
          warningCount++;
          break;
        case "info":
          infoCount++;
          break;
        case "hint":
          hintCount++;
          break;
      }
    }
  }

  return {
    fileCount: diagnostics.length,
    errorCount,
    warningCount,
    infoCount,
    hintCount,
    totalCount: errorCount + warningCount + infoCount + hintCount,
  };
}

/**
 * Format diagnostics with summary (concise format for post-merge validation)
 */
export function formatDiagnosticsWithSummary(
  diagnostics: FileDiagnostics[],
  cwd: string,
  options: {
    minSeverity?: DiagnosticSeverity;
    maxPerFile?: number;
  } = {},
): string {
  const filtered = options.minSeverity
    ? filterBySeverity(diagnostics, options.minSeverity)
    : diagnostics;

  if (filtered.length === 0) {
    return "No diagnostics found.";
  }

  const summary = summarizeDiagnostics(filtered);
  const maxPerFile = options.maxPerFile ?? MAX_DIAGNOSTICS_PER_FILE;

  const header = `LSP Diagnostics Summary: ${summary.errorCount} error${summary.errorCount !== 1 ? "s" : ""}, ${summary.warningCount} warning${summary.warningCount !== 1 ? "s" : ""} across ${summary.fileCount} file${summary.fileCount !== 1 ? "s" : ""}`;

  const details = filtered
    .map(({ path: filePath, diagnostics: entries }) => {
      const rel = path.relative(cwd, filePath) || filePath;
      const lines = entries.slice(0, maxPerFile).map((diag) => {
        const { line, character } = diag.range.start;
        const location = `${line + 1}:${character + 1}`;
        const source = diag.source ? ` · ${diag.source}` : "";
        return `  - [${diag.severity.toUpperCase()}] ${diag.message} (${location}${source})`;
      });
      const trimmed = entries.length > maxPerFile ? `  - … (${entries.length - maxPerFile} more)` : "";
      return [`• ${rel}`, ...lines, trimmed].filter(Boolean).join("\n");
    })
    .join("\n");

  return `${header}\n\n${details}`;
}

