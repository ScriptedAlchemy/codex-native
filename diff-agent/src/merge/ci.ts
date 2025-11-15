import {
  CI_LOG_CONTEXT_LIMIT,
  CI_OVERFLOW_SUMMARY_CHAR_LIMIT,
  CI_SNIPPET_CONTEXT_LINES,
  CI_SNIPPET_KEYWORDS,
  CI_SNIPPET_MAX_SECTIONS,
} from "./constants.js";
import type { CiFailure, WorkerOutcome } from "./types.js";

export type CiSnippet = {
  text: string;
  startLine: number;
  endLine: number;
};

export function collectCiSnippets(log: string): CiSnippet[] {
  const lines = log.split(/\r?\n/);
  const snippets: CiSnippet[] = [];
  for (let i = 0; i < lines.length && snippets.length < CI_SNIPPET_MAX_SECTIONS; i += 1) {
    const line = lines[i];
    if (!line || !CI_SNIPPET_KEYWORDS.test(line)) {
      continue;
    }
    const start = Math.max(0, i - CI_SNIPPET_CONTEXT_LINES);
    const end = Math.min(lines.length, i + CI_SNIPPET_CONTEXT_LINES + 1);
    const snippetLines = lines.slice(start, end);
    snippets.push({
      text: snippetLines.join("\n"),
      startLine: start + 1,
      endLine: end,
    });
    i = end - 1;
  }
  return snippets;
}

export function buildCiSnippetSection(log: string): string | null {
  const snippets = collectCiSnippets(log);
  if (snippets.length === 0) {
    return null;
  }
  const section = snippets
    .map(
      (snippet, idx) =>
        `Snippet ${idx + 1} (lines ${snippet.startLine}-${snippet.endLine}):\n${snippet.text}`,
    )
    .join("\n\n");
  return `[Keyword snippets]\n${section}`;
}

export function extractCiFailures(log: string): CiFailure[] {
  const snippets = collectCiSnippets(log);
  return snippets.map((snippet, idx) => {
    const pathHints = derivePathHints(snippet.text);
    const snippetLead = snippet.text
      .split(/\r?\n/)[0]
      .trim()
      .slice(0, 80);
    const label = (pathHints[0] ?? snippetLead) || `ci-failure-${idx + 1}`;
    return {
      label,
      snippet: snippet.text,
      pathHints,
    };
  });
}

export function derivePathHints(text: string): string[] {
  const hints = new Set<string>();
  const pathRegex = /([A-Za-z0-9_./-]+\.(?:rs|ts|tsx|js|jsx|py|sh|toml|json|yml|yaml|md))/g;
  for (const match of text.matchAll(pathRegex)) {
    hints.add(match[1]);
  }
  const crateRegex = /----\s+([A-Za-z0-9_:-]+)\s*----/g;
  for (const match of text.matchAll(crateRegex)) {
    hints.add(match[1]);
  }
  return Array.from(hints);
}

export function matchCiFailureToOutcome(failure: CiFailure, outcomes: WorkerOutcome[]): WorkerOutcome | null {
  if (!failure.pathHints.length) {
    return null;
  }
  for (const outcome of outcomes) {
    if (!outcome.path) {
      continue;
    }
    if (failure.pathHints.some((hint) => outcome.path.includes(hint) || hint.includes(outcome.path))) {
      return outcome;
    }
  }
  return null;
}

export function prepareCiLogWithSnippets(ciLog: string, snippetSection: string | null): string {
  if (ciLog.length <= CI_LOG_CONTEXT_LIMIT) {
    return snippetSection ? `${ciLog}\n\n${snippetSection}` : ciLog;
  }
  return ciLog; // caller will handle summarization when overflow occurs
}

export function clampOverflowForSummary(overflow: string): { chunk: string; skippedPrefix: number } {
  if (!overflow) {
    return { chunk: "", skippedPrefix: 0 };
  }
  if (overflow.length <= CI_OVERFLOW_SUMMARY_CHAR_LIMIT) {
    return { chunk: overflow, skippedPrefix: 0 };
  }
  return {
    chunk: overflow.slice(-CI_OVERFLOW_SUMMARY_CHAR_LIMIT),
    skippedPrefix: overflow.length - CI_OVERFLOW_SUMMARY_CHAR_LIMIT,
  };
}
