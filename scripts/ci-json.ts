#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type CiJob = {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
};

type ParsedFailure = {
  label: string;
  details: string;
  pathHints: string[];
};

type CiJobResult = {
  name: string;
  command: string;
  status: "passed" | "failed" | "error";
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  failureSummary?: string;
  parsedFailures?: ParsedFailure[];
};

const CI_JOBS: CiJob[] = [
  { name: "ci:format", command: "pnpm run ci:format" },
  { name: "ci:codespell", command: "pnpm run ci:codespell" },
  { name: "ci:mcp-types", command: "pnpm run ci:mcp-types" },
  { name: "ci:shear", command: "pnpm run ci:shear" },
  { name: "ci:clippy", command: "pnpm run ci:clippy" },
  { name: "ci:test:fast", command: "pnpm run ci:test:fast" },
];

function runJob(job: CiJob): CiJobResult {
  const [cmd, ...args] = job.command.split(" ");
  const start = Date.now();
  const proc = spawnSync(cmd, args, {
    cwd: job.cwd ?? process.cwd(),
    env: { ...process.env, ...job.env },
    encoding: "utf8",
    shell: false,
  });
  const durationMs = Date.now() - start;
  const exitCode = proc.status ?? 0;
  const status: CiJobResult["status"] = exitCode === 0 ? "passed" : "failed";
  const failureSummary = exitCode === 0 ? undefined : summarizeFailure(proc.stderr || proc.stdout || "");
  const parsedFailures = exitCode === 0 ? [] : parseFailures(job.name, proc.stdout ?? "", proc.stderr ?? "");
  return {
    name: job.name,
    command: job.command,
    status,
    exitCode,
    durationMs,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    failureSummary,
    parsedFailures,
  };
}

function parseFailures(jobName: string, stdout: string, stderr: string): ParsedFailure[] {
  const failures: ParsedFailure[] = [];
  const log = `${stdout}\n${stderr}`;
  const cargoRegex = /^test\s+([\w:]+)\s+\.\.\.\s+FAILED$/gm;
  let match: RegExpExecArray | null;
  while ((match = cargoRegex.exec(log)) !== null) {
    const testName = match[1];
    failures.push({
      label: `${jobName}:${testName}`,
      details: extractSnippet(log, match.index),
      pathHints: [testName],
    });
  }

  const jestRegex = /^●\s+([^\n]+)$/gm;
  while ((match = jestRegex.exec(log)) !== null) {
    const suiteLine = match[1].trim();
    const snippet = extractSnippet(log, match.index);
    failures.push({
      label: `${jobName}:${suiteLine}`,
      details: snippet,
      pathHints: suiteLine.split(/[›>]/).map((part) => part.trim()).filter(Boolean),
    });
  }

  return failures;
}

function extractSnippet(text: string, startIndex: number, contextLines = 8): string {
  const lines = text.split(/\r?\n/);
  let running = 0;
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i += 1) {
    running += lines[i].length + 1;
    if (running >= startIndex) {
      lineIndex = i;
      break;
    }
  }
  const begin = Math.max(0, lineIndex - 2);
  const end = Math.min(lines.length, lineIndex + contextLines);
  return lines.slice(begin, end).join("\n");
}

function summarizeFailure(log: string): string {
  if (!log) {
    return "(no log output)";
  }
  const lines = log.trim().split(/\r?\n/);
  const tail = lines.slice(-20).join("\n");
  return tail.slice(-1200);
}

function writeReport(results: CiJobResult[]): void {
  const dir = path.join(process.cwd(), ".codex-ci");
  mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, "ci-report.json");
  const report = { generatedAt: new Date().toISOString(), results };
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`📄 CI JSON report written to ${outputPath}`);
  console.log("CI_JSON_REPORT", JSON.stringify(report));
}

async function main(): Promise<void> {
  const results: CiJobResult[] = [];
  for (const job of CI_JOBS) {
    console.log(`▶️ Running ${job.name} (${job.command})`);
    const result = runJob(job);
    results.push(result);
    console.log(`   ${job.name} ${result.status.toUpperCase()} (exit ${result.exitCode}, ${result.durationMs}ms)`);
    if (result.status === "failed") {
      console.log(`   stderr preview:\n${result.stderr.slice(0, 2000)}`);
    }
  }
  writeReport(results);
  const failed = results.filter((r) => r.status !== "passed");
  if (failed.length > 0) {
    console.error(`❌ ${failed.length} job(s) failed:`);
    failed.forEach((job) => console.error(`   - ${job.name} (exit ${job.exitCode})`));
    process.exitCode = 1;
  } else {
    console.log("✅ All CI jobs succeeded.");
  }
}

void main();
