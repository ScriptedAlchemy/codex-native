import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Agent, Runner } from "@openai/agents";
import type { JsonSchemaDefinition } from "@openai/agents-core";
import {
  CodexProvider,
  collectRepoDiffSummary,
  fastEmbedInit,
  LspManager,
  reverieSearchSemantic,
  type FileDiagnostics,
  type LspManagerOptions,
  type RepoDiffSummary,
  type RepoDiffFileChange,
  type ReverieSemanticSearchOptions,
} from "@codex-native/sdk";
import { createDefaultSolverConfig, MergeConflictSolver } from "./merge-conflict-solver.js";

type BranchIntentPlan = {
  intent_summary: string;
  objectives: Array<{ title: string; evidence: string; impact_scope: "local" | "module" | "system" }>;
  risk_flags: string[];
  file_focus: Array<{ file: string; reason: string; urgency: "low" | "medium" | "high" }>;
};

type FileAssessment = {
  file: string;
  change_intent: string;
  necessity: "required" | "questionable" | "unnecessary";
  minimally_invasive: boolean;
  unnecessary_changes: string[];
  recommendations: string[];
  risk_level: "info" | "low" | "medium" | "high";
};

type ReverieInsight = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

type ReverieContext = {
  branch: ReverieInsight[];
  perFile: Map<string, ReverieInsight[]>;
};

function detectDefaultRepo(): string {
  const cwdGit = findGitRoot(process.cwd());
  if (cwdGit) {
    return cwdGit;
  }
  const legacyPath = "/Volumes/sandisk/codex/multi-agent-codex-system";
  if (fs.existsSync(path.join(legacyPath, ".git"))) {
    return legacyPath;
  }
  return process.cwd();
}

const DEFAULT_DIFF_AGENT_REPO = detectDefaultRepo();
const DEFAULT_MODEL = "gpt-5.1-codex";
const DEFAULT_MAX_FILES = 12;
const DEFAULT_REVERIE_LIMIT = 6;
const DEFAULT_REVERIE_MAX_CANDIDATES = 80;
const REVERIE_EMBED_MODEL = "BAAI/bge-large-en-v1.5";
const REVERIE_RERANKER_MODEL = "BAAI/bge-reranker-v2-m3";
const LOG_LABEL = "[DiffAgent]";
const MAX_DIAGNOSTICS_PER_FILE = 4;
let reverieReady = false;

const BRANCH_PLAN_OUTPUT_TYPE: JsonSchemaDefinition = {
  type: "json_schema",
  name: "DiffBranchOverview",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["intent_summary", "objectives", "risk_flags", "file_focus"],
    properties: {
      intent_summary: { type: "string", minLength: 20, maxLength: 1_200 },
      objectives: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "evidence", "impact_scope"],
          properties: {
            title: { type: "string", minLength: 5, maxLength: 160 },
            evidence: { type: "string", minLength: 5, maxLength: 400 },
            impact_scope: { type: "string", enum: ["local", "module", "system"] },
          },
        },
      },
      risk_flags: {
        type: "array",
        maxItems: 8,
        items: { type: "string", minLength: 5, maxLength: 240 },
      },
      file_focus: {
        type: "array",
        minItems: 1,
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["file", "reason", "urgency"],
          properties: {
            file: { type: "string", minLength: 1, maxLength: 260 },
            reason: { type: "string", minLength: 5, maxLength: 240 },
            urgency: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      },
    },
  },
};

const FILE_ASSESSMENT_OUTPUT_TYPE: JsonSchemaDefinition = {
  type: "json_schema",
  name: "DiffFileAssessment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "file",
      "change_intent",
      "necessity",
      "minimally_invasive",
      "unnecessary_changes",
      "recommendations",
      "risk_level",
    ],
    properties: {
      file: { type: "string", minLength: 1, maxLength: 260 },
      change_intent: { type: "string", minLength: 10, maxLength: 600 },
      necessity: { type: "string", enum: ["required", "questionable", "unnecessary"] },
      minimally_invasive: { type: "boolean" },
      unnecessary_changes: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 5, maxLength: 220 },
      },
      recommendations: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 5, maxLength: 220 },
      },
      risk_level: { type: "string", enum: ["info", "low", "medium", "high"] },
    },
  },
};

const repoPath = process.env.CX_DIFF_AGENT_REPO ?? DEFAULT_DIFF_AGENT_REPO;
const baseOverride = process.env.CX_DIFF_AGENT_BASE;
const baseUrl = process.env.CODEX_BASE_URL;
const apiKey = process.env.CODEX_API_KEY;
const model = process.env.CX_DIFF_AGENT_MODEL ?? DEFAULT_MODEL;
const maxFiles = parseEnvInt(process.env.CX_DIFF_AGENT_MAX_FILES, DEFAULT_MAX_FILES);

void main().catch((error) => {
  console.error(`${LOG_LABEL} fatal error`, error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--merge")) {
    const mergeRepo = assertRepo(process.cwd());
    const config = createDefaultSolverConfig(mergeRepo);
    const solver = new MergeConflictSolver(config);
    await solver.run();
    return;
  }

  if (args.includes("--ci")) {
    const ciRepo = assertRepo(process.cwd());

    // Always use the enhanced orchestrator with auto-fix capabilities
    const { runEnhancedCiOrchestrator } = await import("./ci/enhanced-ci-orchestrator.js");
    await runEnhancedCiOrchestrator(ciRepo, {
      visualize: true, // Always show visual progress
      autoFix: true,   // Always attempt to fix issues
      maxIterations: 5,
    });
    return;
  }

  const resolvedRepo = assertRepo(repoPath);
  const context = await collectRepoDiffSummary({
    cwd: resolvedRepo,
    baseBranchOverride: baseOverride,
    maxFiles,
  });
  if (context.changedFiles.length === 0) {
    console.log(`${LOG_LABEL} No changed files detected between ${context.mergeBase} and HEAD.`);
    return;
  }

  const runner = createRunner(resolvedRepo, { model, baseUrl, apiKey });
  const reverieContext = await collectReverieContext(context);
  const branchPlan = await analyzeBranchIntent(runner, context, reverieContext.branch);

  renderBranchReport(context, branchPlan, reverieContext.branch);

  const diagnosticsByFile = await collectDiagnosticsForChanges(context);

  for (const change of context.changedFiles) {
    const insights = reverieContext.perFile.get(change.path) ?? [];
    const assessment = await assessFileChange(runner, context, change, branchPlan, insights);
    const diagnostics = diagnosticsByFile.get(normalizeRepoPath(change.path));
    renderFileAssessment(assessment, change, insights, diagnostics);
  }
}

function createRunner(
  repo: string,
  options: { model: string; baseUrl?: string; apiKey?: string },
): Runner {
  const provider = new CodexProvider({
    workingDirectory: repo,
    skipGitRepoCheck: true,
    defaultModel: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
  return new Runner({ modelProvider: provider });
}

async function collectReverieContext(context: RepoDiffSummary): Promise<ReverieContext> {
  const branchContext = [
    `Branch: ${context.branch} -> Base: ${context.baseBranch}`,
    `Status:\n${context.statusSummary}`,
    `Diff stat:\n${context.diffStat}`,
    `Recent commits:\n${context.recentCommits}`,
  ].join("\n\n");
  const branchInsights = await searchReveries(branchContext, context.repoPath);
  const perFile = new Map<string, ReverieInsight[]>();
  for (const change of context.changedFiles) {
    const snippet = `${change.path}\nStatus: ${change.status}\n\n${change.diff.slice(0, 4_000)}`;
    const matches = await searchReveries(snippet, context.repoPath, DEFAULT_REVERIE_LIMIT, DEFAULT_REVERIE_MAX_CANDIDATES / 2);
    if (matches.length > 0) {
      perFile.set(change.path, matches);
    }
  }
  return { branch: branchInsights, perFile };
}

async function searchReveries(
  text: string,
  repo: string,
  limit = DEFAULT_REVERIE_LIMIT,
  maxCandidates = DEFAULT_REVERIE_MAX_CANDIDATES,
): Promise<ReverieInsight[]> {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  if (!fs.existsSync(codexHome)) {
    return [];
  }
  await ensureReverieReady();
  const options: ReverieSemanticSearchOptions = {
    projectRoot: repo,
    limit,
    maxCandidates,
    rerankerModel: REVERIE_RERANKER_MODEL,
    rerankerTopK: 20,
    rerankerBatchSize: 8,
  };
  try {
    const matches = await reverieSearchSemantic(codexHome, normalized, options);
    return matches.slice(0, limit).map((match) => ({
      conversationId: match.conversation?.id || "unknown",
      timestamp: match.conversation?.createdAt || new Date().toISOString(),
      relevance: typeof match.relevanceScore === "number" ? match.relevanceScore : 0,
      excerpt: match.matchingExcerpts?.[0] || "",
      insights: Array.isArray(match.insights) ? match.insights : [],
    }));
  } catch (error) {
    console.warn(`${LOG_LABEL} Reverie search failed:`, error);
    return [];
  }
}

async function ensureReverieReady(): Promise<void> {
  if (reverieReady) {
    return;
  }
  try {
    await fastEmbedInit({ model: REVERIE_EMBED_MODEL, showDownloadProgress: true });
    reverieReady = true;
  } catch (error) {
    console.warn(`${LOG_LABEL} Failed to initialize reverie embedder:`, error);
  }
}

async function analyzeBranchIntent(
  runner: Runner,
  context: RepoDiffSummary,
  branchReveries: ReverieInsight[],
): Promise<BranchIntentPlan> {
  const branchAgent = new Agent<unknown, JsonSchemaDefinition>({
    name: "BranchIntentAnalyzer",
    outputType: BRANCH_PLAN_OUTPUT_TYPE,
    instructions: `# Branch Intent Analyst\n\nYou inspect the diff between a feature branch and its base.\n\nGoals:\n1. Explain the high-level intent for this branch.\n2. Surface 3-8 concrete objectives backing that intent.\n3. Flag architectural or risk issues when the diff looks unnecessary or overly invasive.\n4. Identify which files deserve deeper scrutiny and why.\n\nRespond strictly with JSON matching the provided schema.`,
  });
  const prompt = buildBranchPrompt(context, branchReveries);
  const result = await runner.run(branchAgent, prompt);
  const fallback: BranchIntentPlan = {
    intent_summary: "Unable to infer branch intent.",
    objectives: [],
    risk_flags: [],
    file_focus: context.changedFiles.map((file) => ({ file: file.path, reason: "Changed file", urgency: "medium" })),
  };
  return parseStructuredOutput<BranchIntentPlan>(result.finalOutput, fallback);
}

async function assessFileChange(
  runner: Runner,
  context: RepoDiffSummary,
  change: RepoDiffFileChange,
  plan: BranchIntentPlan,
  insights: ReverieInsight[],
): Promise<FileAssessment> {
  const reviewer = new Agent<unknown, JsonSchemaDefinition>({
    name: "FileChangeInspector",
    outputType: FILE_ASSESSMENT_OUTPUT_TYPE,
    instructions: `# File Diff Inspector\n\nJudge whether each change pushes the branch's goals forward.\n- Capture the developer's intent for this file.\n- Decide if the change was necessary, questionable, or unnecessary.\n- Note if it stays minimally invasive (touching only what's needed).\n- List specific unnecessary chunks when you spot churn.\n- Recommend fixes, removals, or follow-ups for risky areas.\n\nRespond as JSON only.`,
  });
  const input = buildFilePrompt(context, change, plan, insights);
  const fallback: FileAssessment = {
    file: change.path,
    change_intent: "",
    necessity: "questionable",
    minimally_invasive: false,
    unnecessary_changes: [],
    recommendations: [],
    risk_level: "info",
  };
  return parseStructuredOutput<FileAssessment>((await runner.run(reviewer, input)).finalOutput, fallback);
}

function buildBranchPrompt(context: RepoDiffSummary, insights: ReverieInsight[]): string {
  const filesPreview = context.changedFiles
    .map((file, index) => `${index + 1}. [${file.status}] ${file.path}${file.truncated ? " (diff truncated)" : ""}`)
    .join("\n");
  return [
    `Repo: ${context.repoPath}`,
    `Branch: ${context.branch}`,
    `Base: ${context.baseBranch}`,
    `Merge base: ${context.mergeBase}`,
    ``,
    `Git status:\n${context.statusSummary}`,
    ``,
    `Diff stat:\n${context.diffStat}`,
    ``,
    `Recent commits:\n${context.recentCommits}`,
    ``,
    `Changed files (showing ${context.changedFiles.length} of ${context.totalChangedFiles}):\n${filesPreview}`,
    ``,
    insights.length > 0
      ? `Relevant reveries:\n${formatReveries(insights)}`
      : "No reverie context found.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildFilePrompt(
  context: RepoDiffSummary,
  change: RepoDiffFileChange,
  plan: BranchIntentPlan,
  insights: ReverieInsight[],
): string {
  const focusEntry = plan.file_focus.find((entry) => entry.file === change.path);
  return [
    `Branch intent summary: ${plan.intent_summary}`,
    `Objectives:\n${plan.objectives.map((obj) => `- ${obj.title} (${obj.impact_scope}): ${obj.evidence}`).join("\n")}`,
    plan.risk_flags.length > 0 ? `Active risk flags:\n${plan.risk_flags.map((flag) => `- ${flag}`).join("\n")}` : "No branch-level risks recorded.",
    focusEntry ? `Focus guidance for this file:\n${focusEntry.reason} (urgency: ${focusEntry.urgency})` : `File ${change.path} was not explicitly highlighted in the plan.`,
    `File status: ${change.status}${change.previousPath ? ` (from ${change.previousPath})` : ""}`,
    `Diff:\n${change.diff}`,
    insights.length > 0 ? `Reverie matches:\n${formatReveries(insights)}` : "No reverie insight for this file.",
    `Decide necessity + invasiveness for ${change.path} vs base ${context.baseBranch}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseStructuredOutput<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed as T;
  } catch (error) {
    console.warn(`${LOG_LABEL} Failed to parse structured output`, error);
    return fallback;
  }
}

async function collectDiagnosticsForChanges(context: RepoDiffSummary): Promise<Map<string, FileDiagnostics>> {
  const diagnostics = new Map<string, FileDiagnostics>();
  if (context.changedFiles.length === 0) {
    return diagnostics;
  }

  const managerOptions: LspManagerOptions = {
    workingDirectory: context.repoPath,
    waitForDiagnostics: true,
  };
  const manager = new LspManager(managerOptions);

  try {
    const targets = context.changedFiles.map((change) =>
      path.isAbsolute(change.path) ? change.path : path.resolve(context.repoPath, change.path),
    );
    const entries = await manager.collectDiagnostics(targets);
    for (const entry of entries) {
      const relative = path.relative(context.repoPath, entry.path) || entry.path;
      diagnostics.set(normalizeRepoPath(relative), entry);
    }
  } catch (error) {
    console.warn(`${LOG_LABEL} Unable to collect LSP diagnostics:`, error);
  } finally {
    try {
      await manager.dispose();
    } catch {
      // ignore cleanup errors
    }
  }

  return diagnostics;
}

function renderBranchReport(context: RepoDiffSummary, plan: BranchIntentPlan, insights: ReverieInsight[]): void {
  console.log(`\n${LOG_LABEL} Branch Intent Summary`);
  console.log(`Branch ${context.branch} vs ${context.baseBranch} (merge-base ${context.mergeBase})`);
  console.log(`Intent: ${plan.intent_summary || "(missing)"}`);
  if (plan.objectives.length > 0) {
    console.log("Objectives:");
    plan.objectives.forEach((obj, idx) => {
      console.log(`  ${idx + 1}. ${obj.title} [${obj.impact_scope}] - ${obj.evidence}`);
    });
  }
  if (plan.risk_flags.length > 0) {
    console.log("Risks:");
    plan.risk_flags.forEach((flag) => console.log(`  - ${flag}`));
  }
  if (plan.file_focus.length > 0) {
    console.log("Focus files:");
    plan.file_focus.forEach((entry) => {
      console.log(`  - ${entry.file}: ${entry.reason} (urgency: ${entry.urgency})`);
    });
  }
  if (insights.length > 0) {
    console.log("Reverie highlights:");
    insights.slice(0, 3).forEach((match) => {
      console.log(`  - ${match.insights.join("; ") || match.excerpt} (${Math.round(match.relevance * 100)}%)`);
    });
  }
}

function renderFileAssessment(
  assessment: FileAssessment,
  change: RepoDiffFileChange,
  insights: ReverieInsight[],
  diagnostics?: FileDiagnostics,
): void {
  console.log(`\n${LOG_LABEL} File: ${assessment.file}`);
  console.log(`Status: ${change.status}${change.previousPath ? ` (from ${change.previousPath})` : ""}`);
  console.log(`Intent: ${assessment.change_intent || "(not captured)"}`);
  console.log(`Necessity: ${assessment.necessity} | Minimally invasive: ${assessment.minimally_invasive ? "yes" : "no"} | Risk: ${assessment.risk_level}`);
  if (assessment.unnecessary_changes.length > 0) {
    console.log("Unnecessary changes:");
    assessment.unnecessary_changes.forEach((item) => console.log(`  - ${item}`));
  }
  if (assessment.recommendations.length > 0) {
    console.log("Recommendations:");
    assessment.recommendations.forEach((item) => console.log(`  - ${item}`));
  }
  if (insights.length > 0) {
    console.log("Reverie cues:");
    insights.slice(0, 2).forEach((match) => {
      console.log(`  - ${match.insights.join("; ") || match.excerpt} (${Math.round(match.relevance * 100)}%)`);
    });
  }
  if (diagnostics && diagnostics.diagnostics.length > 0) {
    console.log("Diagnostics:");
    diagnostics.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE).forEach((diag) => {
      const { line, character } = diag.range.start;
      const location = `${line + 1}:${character + 1}`;
      const source = diag.source ? ` · ${diag.source}` : "";
      console.log(`  - [${diag.severity.toUpperCase()}] ${diag.message} (${location}${source})`);
    });
    if (diagnostics.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      console.log("  - …");
    }
  }
}

function formatReveries(matches: ReverieInsight[]): string {
  return matches
    .map((match, idx) => {
      const title = match.insights[0] || match.excerpt || "Insight";
      return `#${idx + 1} (${Math.round(match.relevance * 100)}%) ${title}`;
    })
    .join("\n");
}

function assertRepo(candidate: string): string {
  const resolved = path.resolve(candidate);
  const root = findGitRoot(resolved);
  if (!root) {
    throw new Error(`Repository not found at ${resolved}`);
  }
  return root;
}

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      try {
        const stats = fs.statSync(gitPath);
        if (stats.isDirectory() || stats.isFile()) {
          return current;
        }
      } catch {
        // ignore and keep moving up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
