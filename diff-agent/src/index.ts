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
  logger,
  LspManager,
  reverieSearchSemantic,
  type FileDiagnostics,
  type LspManagerOptions,
  type RepoDiffSummary,
  type RepoDiffFileChange,
  type ReverieSemanticSearchOptions,
} from "@codex-native/sdk";
import type { FastEmbedRerankerModelCode } from "@codex-native/sdk";
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
const DEFAULT_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_MAX_FILES = 12;
const DEFAULT_REVERIE_LIMIT = 6;
const DEFAULT_REVERIE_MAX_CANDIDATES = 80;
const REVERIE_EMBED_MODEL = "BAAI/bge-large-en-v1.5";
const REVERIE_RERANKER_MODEL: FastEmbedRerankerModelCode = "rozgo/bge-reranker-v2-m3";
const LOG_LABEL = "[DiffAgent]";
const MAX_DIAGNOSTICS_PER_FILE = 4;
let reverieReady = false;

// Create scoped logger for diff-agent
const log = logger.scope("reviewer");

// ANSI color codes for section headers
const COLORS = {
  branchHeader: "\x1b[1m\x1b[35m",  // Bold magenta for branch analysis
  fileHeader: "\x1b[1m\x1b[36m",    // Bold cyan for file analysis
  reverie: "\x1b[90m",               // Dark grey for reverie context
  reset: "\x1b[0m",
};

// Helper to truncate text for display
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

// Helper to log user-facing content (results) with visual distinction
function logResult(message: string): void {
  console.log(`${message}`);
}

/**
 * Check if a reverie excerpt contains meaningful conversation context
 * vs system prompts, boilerplate, or low-value content
 */
function isValidReverieExcerpt(excerpt: string): boolean {
  if (!excerpt || excerpt.trim().length < 20) {
    return false;
  }

  // Skip excerpts that are primarily system prompts or boilerplate
  const skipPatterns = [
    "# AGENTS.md instructions",
    "AGENTS.md instructions for",
    "<INSTRUCTIONS>",
    "<environment_context>",
    "<system>",
    "Sandbox env vars",
    "Tool output:",
    "approval_policy",
    "sandbox_mode",
    "network_access",
    "<cwd>",
    "</cwd>",
    "CODEX_SAN",
    "# Codex Workspace Agent Guide",
    "## Core Expectations",
    "Crates in `codex-rs` use the `codex-` prefix",
    "Install repo helpers",
    "CI Fix Orchestrator",
    "CI Remediation Orchestrator",
    "Branch Intent Analyst",
    "File Diff Inspector",
    "You are coordinating an automated",
    "Respond strictly with JSON",
    "Judge whether each change",
  ];

  const normalized = excerpt.toLowerCase();

  // Check if excerpt is mostly boilerplate
  const boilerplateCount = skipPatterns.filter(pattern =>
    normalized.includes(pattern.toLowerCase())
  ).length;

  // If ANY boilerplate patterns found, skip this excerpt (stricter filtering)
  if (boilerplateCount >= 1) {
    return false;
  }

  // Skip excerpts with weird percentage indicators that appear in tool outputs
  // (like "(130%)" or "(89%)" at the end)
  if (/\(\d{2,3}%\)\s*$/.test(excerpt.trim())) {
    return false;
  }

  // Skip excerpts that look like JSON output
  if (excerpt.trim().startsWith("{") && excerpt.includes('"file"')) {
    return false;
  }

  // Skip excerpts that are mostly XML/HTML tags
  const tagCount = (excerpt.match(/<[^>]+>/g) || []).length;
  if (tagCount > 3) {
    return false;
  }

  return true;
}

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
  log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  log.info(`Starting diff-agent (args: ${args.join(' ') || 'none'})`);

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
  log.info(`Collecting diff summary for ${resolvedRepo}...`);

  // Determine base branch for comparison - use explicit override or default to main
  const effectiveBaseBranch = baseOverride || "main";

  // Collect diff context
  const context = await collectRepoDiffSummary({
    cwd: resolvedRepo,
    baseBranchOverride: effectiveBaseBranch,
    maxFiles,
  });

  // If no changes found
  if (context.changedFiles.length === 0) {
    // Check if we're on the base branch (main/master)
    const isOnBaseBranch = context.branch === effectiveBaseBranch ||
                           context.branch === "main" ||
                           context.branch === "master";

    if (isOnBaseBranch) {
      log.info(`Currently on base branch ${context.branch} with no uncommitted changes`);
      log.info(`Nothing to review - branch is clean`);
      return;
    }

    // Feature branch with no changes vs base - already merged or empty branch
    log.info(`No changes found in branch ${context.branch} vs ${context.baseBranch}`);
    log.info(`Branch appears to be up-to-date with or already merged into ${context.baseBranch}`);
    return;
  }

  // Determine review mode based on changes
  const hasUncommittedChanges = context.statusSummary.includes("modified:") ||
                                 context.statusSummary.includes("new file:") ||
                                 context.statusSummary.includes("deleted:");

  if (hasUncommittedChanges) {
    log.info(`Found ${context.changedFiles.length} files with uncommitted changes`);
  } else {
    log.info(`PR-style review: Found ${context.changedFiles.length} committed files vs ${context.baseBranch}`);
  }

  const runner = createRunner(resolvedRepo, { model, baseUrl, apiKey });
  log.info(`Using model: ${model}`);

  await performReview(runner, context);
}

async function performReview(runner: Runner, context: RepoDiffSummary): Promise<void> {
  log.info(`Collecting reverie context from past conversations...`);
  const reverieContext = await collectReverieContext(context);

  log.info(`Analyzing branch intent with ${reverieContext.branch.length} reverie insights...`);
  const branchPlan = await analyzeBranchIntent(runner, context, reverieContext.branch);

  renderBranchReport(context, branchPlan, reverieContext.branch);

  log.info(`Collecting LSP diagnostics for changed files...`);
  const diagnosticsByFile = await collectDiagnosticsForChanges(context);
  log.info(`LSP diagnostics collected for ${diagnosticsByFile.size} files`);

  log.info(`Assessing ${context.changedFiles.length} file changes...`);
  for (const change of context.changedFiles) {
    log.info(`  Analyzing ${change.path}...`);
    const insights = reverieContext.perFile.get(change.path) ?? [];
    const assessment = await assessFileChange(runner, context, change, branchPlan, insights);
    const diagnostics = diagnosticsByFile.get(normalizeRepoPath(change.path));
    renderFileAssessment(assessment, change, insights, diagnostics);
  }
  log.info(`Analysis complete`);
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
  // Build a more focused search query that emphasizes intent over technical details
  const branchContext = [
    `Working on branch: ${context.branch}`,
    `Files changed: ${context.changedFiles.map(f => f.path).join(", ")}`,
    `Recent work: ${context.recentCommits.split("\n").slice(0, 3).join(" ")}`,
  ].join("\n");

  log.info(`Searching reverie for branch context...`);
  const branchInsights = await searchReveries(branchContext, context.repoPath);
  log.info(`Found ${branchInsights.length} relevant reverie matches for branch`);

  const perFile = new Map<string, ReverieInsight[]>();
  log.info(`Searching reverie for ${context.changedFiles.length} individual files...`);
  for (const change of context.changedFiles) {
    // Focus search on file path and key code symbols, not full diff
    const snippet = `File: ${change.path}\nImplementing changes related to: ${extractKeySymbols(change.diff)}`;
    const matches = await searchReveries(snippet, context.repoPath, DEFAULT_REVERIE_LIMIT, DEFAULT_REVERIE_MAX_CANDIDATES / 2);
    if (matches.length > 0) {
      perFile.set(change.path, matches);
      log.info(`  ${change.path}: ${matches.length} matches`);
    }
  }
  log.info(`Reverie context collection complete (${perFile.size} files with context)`);
  return { branch: branchInsights, perFile };
}

/**
 * Extract key symbols and terms from a diff to make search queries more targeted
 */
function extractKeySymbols(diff: string): string {
  // Extract function/class names, avoiding boilerplate patterns
  const symbols = new Set<string>();

  // Match function/class definitions
  const functionMatch = diff.match(/(?:function|class|const|let|var|export|interface|type)\s+(\w+)/g);
  if (functionMatch) {
    functionMatch.forEach(match => {
      const name = match.split(/\s+/).pop();
      if (name && name.length > 2 && !name.match(/^(true|false|null|undefined|const|let|var)$/)) {
        symbols.add(name);
      }
    });
  }

  // If no symbols found, return a generic placeholder
  if (symbols.size === 0) {
    return "code changes";
  }

  return Array.from(symbols).slice(0, 5).join(", ");
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
    limit: maxCandidates * 3, // Get 3x candidates since we'll filter heavily
    maxCandidates: maxCandidates * 3,
    rerankerModel: REVERIE_RERANKER_MODEL,
    rerankerTopK: 20,
    rerankerBatchSize: 8,
  };
  try {
    const matches = await reverieSearchSemantic(codexHome, normalized, options);
    const insights = matches.map((match) => ({
      conversationId: match.conversation?.id || "unknown",
      timestamp: match.conversation?.createdAt || new Date().toISOString(),
      relevance: typeof match.relevanceScore === "number" ? match.relevanceScore : 0,
      excerpt: match.matchingExcerpts?.[0] || "",
      insights: Array.isArray(match.insights) ? match.insights : [],
    }));

    // Filter out system prompts and boilerplate aggressively
    const validInsights = insights.filter(insight => isValidReverieExcerpt(insight.excerpt));

    // Deduplicate similar excerpts
    const deduplicated = deduplicateInsights(validInsights);

    log.info(`  Filtered ${insights.length} → ${validInsights.length} → ${deduplicated.length} (after dedup)`);

    return deduplicated.slice(0, limit);
  } catch (error) {
    log.warn(`Reverie search failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Remove duplicate or very similar reverie insights
 */
function deduplicateInsights(insights: ReverieInsight[]): ReverieInsight[] {
  const seen = new Set<string>();
  const result: ReverieInsight[] = [];

  for (const insight of insights) {
    // Create a fingerprint based on first 100 chars
    const fingerprint = insight.excerpt.slice(0, 100).toLowerCase().replace(/\s+/g, " ");

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(insight);
    }
  }

  return result;
}

async function ensureReverieReady(): Promise<void> {
  if (reverieReady) {
    return;
  }
  try {
    log.info(`Initializing reverie embedding model (${REVERIE_EMBED_MODEL})...`);
    await fastEmbedInit({ model: REVERIE_EMBED_MODEL, showDownloadProgress: true });
    reverieReady = true;
    log.info(`Reverie embedding model ready`);
  } catch (error) {
    log.warn(`Failed to initialize reverie embedder: ${error instanceof Error ? error.message : String(error)}`);
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
    instructions: `# File Diff Inspector\n\nYour role is to assess whether each file change aligns with the stated branch objectives and provides value.\n\nGuidelines:\n- Capture the developer's intent for this specific file change\n- Evaluate if the change is necessary (advances branch goals), questionable (unclear value), or unnecessary (doesn't contribute to objectives)\n- Assess if the change is minimally invasive - does it touch only what's needed, or does it include unrelated modifications?\n- Flag specific unnecessary chunks only when you spot clear scope creep or churn that doesn't serve the file's stated intent\n- Provide constructive recommendations for improvements, refactoring, or follow-up work\n- Consider that intentional improvements and style modernizations are often necessary for maintainability\n\nArchitectural Preferences:\n- PREFER changes in sdk/native/* over codex-rs/* to keep core changes minimal\n- When reviewing codex-rs/* changes, scrutinize whether they could be implemented in the SDK layer instead\n- Flag codex-rs/* modifications as "questionable" if the same functionality could be achieved via SDK wrappers or bindings\n- Mark codex-rs/* changes as "required" only when they genuinely need core functionality changes\n\nBe balanced and fair in your assessment. Changes that improve code quality, fix technical debt, or align with documented style guides should be marked as "required" even if not strictly necessary for the feature.\n\nRespond as JSON only.`,
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
    log.warn(`Failed to parse structured output: ${error instanceof Error ? error.message : String(error)}`);
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
    log.warn(`Unable to collect LSP diagnostics: ${error instanceof Error ? error.message : String(error)}`);
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
  // Start branch section in magenta
  logResult(`${COLORS.branchHeader}`);
  logResult(`\n${"=".repeat(80)}`);
  logResult(`📋 BRANCH ANALYSIS`);
  logResult(`${"=".repeat(80)}`);
  logResult(`Branch: ${context.branch} vs ${context.baseBranch} (merge-base ${context.mergeBase})`);
  logResult(`\nIntent: ${plan.intent_summary || "(missing)"}`);
  if (plan.objectives.length > 0) {
    logResult(`\nObjectives:`);
    plan.objectives.forEach((obj, idx) => {
      logResult(`  ${idx + 1}. ${obj.title} [${obj.impact_scope}]`);
      logResult(`     ${obj.evidence}`);
    });
  }
  if (plan.risk_flags.length > 0) {
    logResult(`\nRisks:`);
    plan.risk_flags.forEach((flag) => logResult(`  ⚠️  ${flag}`));
  }
  if (plan.file_focus.length > 0) {
    logResult(`\nFocus Files:`);
    plan.file_focus.forEach((entry) => {
      logResult(`  📁 ${entry.file}: ${entry.reason} (urgency: ${entry.urgency})`);
    });
  }
  // Filter and display valid reverie insights
  const validInsights = insights.filter(match => isValidReverieExcerpt(match.excerpt));
  if (validInsights.length > 0) {
    logResult(`\nReverie Highlights:`);
    validInsights.slice(0, 3).forEach((match) => {
      const insight = match.insights.join("; ") || "Context from past work";
      logResult(`  💡 ${insight} (${Math.round(match.relevance * 100)}%)`);
      if (match.excerpt && match.excerpt.trim()) {
        const truncated = truncateText(match.excerpt.replace(/\s+/g, " ").trim(), 200);
        logResult(`     ${COLORS.reverie}${truncated}${COLORS.branchHeader}`);
      }
    });
  } else if (insights.length > 0) {
    // Had insights but they were all filtered out as low-quality
    logResult(`\n${COLORS.reverie}(Reverie found ${insights.length} matches but they were system prompts/boilerplate)${COLORS.branchHeader}`);
  }
  logResult(`${"=".repeat(80)}\n${COLORS.reset}`);
}

function renderFileAssessment(
  assessment: FileAssessment,
  change: RepoDiffFileChange,
  insights: ReverieInsight[],
  diagnostics?: FileDiagnostics,
): void {
  // Start file section in cyan
  logResult(`${COLORS.fileHeader}`);
  logResult(`\n${"-".repeat(80)}`);
  logResult(`📄 FILE: ${assessment.file}`);
  logResult(`${"-".repeat(80)}`);
  logResult(`Status: ${change.status}${change.previousPath ? ` (from ${change.previousPath})` : ""}`);
  logResult(`Intent: ${assessment.change_intent || "(not captured)"}`);
  logResult(`Necessity: ${assessment.necessity} | Minimally invasive: ${assessment.minimally_invasive ? "yes" : "no"} | Risk: ${assessment.risk_level}`);

  if (assessment.unnecessary_changes.length > 0) {
    logResult(`\n⚠️  Unnecessary Changes:`);
    assessment.unnecessary_changes.forEach((item) => logResult(`  • ${item}`));
  }
  if (assessment.recommendations.length > 0) {
    logResult(`\n💡 Recommendations:`);
    assessment.recommendations.forEach((item) => logResult(`  • ${item}`));
  }
  // Filter and display valid reverie insights for this file
  const validInsights = insights.filter(match => isValidReverieExcerpt(match.excerpt));
  if (validInsights.length > 0) {
    logResult(`\n🔍 Reverie Cues:`);
    validInsights.slice(0, 2).forEach((match) => {
      const insight = match.insights.join("; ") || "Context from past work";
      logResult(`  • ${insight} (${Math.round(match.relevance * 100)}%)`);
      if (match.excerpt && match.excerpt.trim()) {
        const truncated = truncateText(match.excerpt.replace(/\s+/g, " ").trim(), 200);
        logResult(`    ${COLORS.reverie}${truncated}${COLORS.fileHeader}`);
      }
    });
  }
  if (diagnostics && diagnostics.diagnostics.length > 0) {
    logResult(`\n🔧 Diagnostics:`);
    diagnostics.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE).forEach((diag) => {
      const { line, character } = diag.range.start;
      const location = `${line + 1}:${character + 1}`;
      const source = diag.source ? ` · ${diag.source}` : "";

      // Color code based on severity (temporarily override cyan base)
      let severityIcon: string;
      let colorCode: string;

      if (diag.severity === "error") {
        severityIcon = "❌";
        colorCode = "\x1b[31m"; // Red
      } else if (diag.severity === "warning") {
        severityIcon = "⚠️";
        colorCode = "\x1b[33m"; // Yellow
      } else {
        severityIcon = "ℹ️";
        colorCode = COLORS.fileHeader; // Keep cyan for info
      }

      logResult(`  ${severityIcon} ${colorCode}[${diag.severity.toUpperCase()}] ${diag.message}${COLORS.fileHeader} (${location}${source})`);
    });
    if (diagnostics.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      logResult(`  … and ${diagnostics.diagnostics.length - MAX_DIAGNOSTICS_PER_FILE} more`);
    }
  }
  logResult(`${"-".repeat(80)}${COLORS.reset}`);
}

function formatReveries(matches: ReverieInsight[]): string {
  // Only include valid excerpts in the formatted output
  const validMatches = matches.filter(match => isValidReverieExcerpt(match.excerpt));

  if (validMatches.length === 0) {
    return "(No meaningful reverie context found)";
  }

  return validMatches
    .map((match, idx) => {
      const insight = match.insights[0] || "Context from past work";
      const excerptPreview = truncateText(match.excerpt.replace(/\s+/g, " ").trim(), 150);
      return `#${idx + 1} (${Math.round(match.relevance * 100)}%) ${insight}\n   Excerpt: ${excerptPreview}`;
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
