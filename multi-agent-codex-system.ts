/**
 * Multi-Agent Codex System - Advanced PR Reviewer & CI Checker
 *
 * This script orchestrates several specialized agents to review the current branch,
 * inspect CI health, and hand off into interactive Codex TUI sessions. It combines:
 *   1. Automated `codex.review()` runs for branch diffs
 *   2. Multi-agent analysis (intent, risk, quality, CI focus)
 *   3. GitHub PR status inspection via `gh pr view/checks`
 *   4. Thread forking so CI analysis can branch off while preserving review context
 *   5. Optional reverie lookup for prior lessons (with embedding-based re-ranking)
 *
 * Embedding Support:
 * To enable semantic re-ranking of reveries, pass an embedder to the config:
 *   config.embedder = {
 *     embed: async (text: string) => {
 *       // Return your embedding vector here (e.g., OpenAI, local model, etc.)
 *       return [0.1, 0.2, ...]; // number[]
 *     }
 *   };
 *
 * The system will:
 * - First recall candidates with native keyword search (fast, broad)
 * - Re-rank top candidates using semantic similarity (slow, precise)
 * - Blend scores: 70% semantic + 30% keyword
 */

import * as process from "node:process";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Agent, Runner, handoff } from "@openai/agents";
import {
  Codex,
  CodexProvider,
  type Thread,
  type NativeTuiExitInfo,
} from "@codex-native/sdk";

const DEFAULT_MODEL = "gpt-5-codex";
const DEFAULT_MINI_MODEL = "gpt-5-codex-mini";
const FALLBACK_BASE_BRANCH = "main";
const MAX_CONTEXT_LINES = 140;
const MAX_CONTEXT_CHARS = 4800;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Embedder = {
  embed(input: string): Promise<number[]>;
};

type MultiAgentConfig = {
  baseUrl?: string;
  apiKey?: string;
  workingDirectory: string;
  skipGitRepoCheck: boolean;
  interactive?: boolean;
  reviewBranch?: boolean;
  ciCheck?: boolean;
  reverieQuery?: string;
  model?: string;
  baseBranchOverride?: string;
  embedder?: Embedder;
};

type RepoContext = {
  cwd: string;
  branch: string;
  baseBranch: string;
  statusSummary: string;
  diffStat: string;
  diffSample: string;
  recentCommits: string;
};

type StatusCheck = {
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  workflow?: string;
};

type PrStatusSummary = {
  number?: number;
  title?: string;
  mergeState?: string;
  headRef?: string;
  baseRef?: string;
  statuses: StatusCheck[];
  ghChecksText?: string;
};

type ReviewAnalysis = {
  summary: string;
  intentions: string[];
  risks: string[];
  recommendations: string[];
  repoContext: RepoContext;
  prStatus?: PrStatusSummary | null;
  thread: Thread;
  ciHandoff?: Thread;
};

type CiAnalysis = {
  issues: string[];
  fixes: string[];
  confidence: number;
  thread: Thread;
};

type ReverieResult = {
  conversationId: string;
  timestamp: string;
  relevance: number;
  excerpt: string;
  insights: string[];
};

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCommand(cmd: string, args: string[], cwd: string): CommandResult {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      code: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return { code: -1, stdout: "", stderr: String(error) };
  }
}

function limitText(input: string, maxLines = MAX_CONTEXT_LINES, maxChars = MAX_CONTEXT_CHARS): string {
  if (!input) return "";
  const lines = input.split(/\r?\n/);
  const trimmed = lines.slice(0, maxLines).join("\n");
  if (trimmed.length <= maxChars) {
    return trimmed.trimEnd();
  }
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function detectBaseBranch(cwd: string, override?: string): string {
  if (override) return override;
  const upstream = runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  if (upstream.code === 0) {
    const value = upstream.stdout.trim();
    const slash = value.lastIndexOf("/");
    return slash === -1 ? value : value.slice(slash + 1);
  }
  return FALLBACK_BASE_BRANCH;
}

function collectRepoContext(cwd: string, baseOverride?: string): RepoContext {
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim() || "unknown";
  const baseBranch = detectBaseBranch(cwd, baseOverride);
  const statusSummary = limitText(runCommand("git", ["status", "-sb"], cwd).stdout || "<no status>");
  const diffStat = limitText(runCommand("git", ["--no-pager", "diff", "--stat"], cwd).stdout || "<no diff>");
  const diffSample = limitText(runCommand("git", ["--no-pager", "diff", "-U3"], cwd).stdout || "<no diff sample>");
  const recentCommits = limitText(
    runCommand("git", ["--no-pager", "log", "-5", "--oneline"], cwd).stdout || "<no commits>",
    20,
    1200,
  );

  return {
    cwd,
    branch,
    baseBranch,
    statusSummary,
    diffStat,
    diffSample,
    recentCommits,
  };
}

function collectPrStatus(cwd: string): PrStatusSummary | null {
  const view = runCommand("gh", [
    "pr",
    "view",
    "--json",
    "number,title,mergeStateStatus,statusCheckRollup,headRefName,baseRefName",
  ], cwd);
  if (view.code !== 0) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(view.stdout);
  } catch {
    return null;
  }

  const statuses: StatusCheck[] = Array.isArray(parsed.statusCheckRollup)
    ? parsed.statusCheckRollup.map((item: any) => ({
        name: item?.name ?? item?.workflowName ?? "<unknown>",
        status: item?.status ?? "UNKNOWN",
        conclusion: item?.conclusion ?? undefined,
        url: item?.detailsUrl ?? undefined,
        workflow: item?.workflowName ?? undefined,
      }))
    : [];

  const checksText = runCommand("gh", ["pr", "checks"], cwd);

  return {
    number: parsed.number,
    title: parsed.title,
    mergeState: parsed.mergeStateStatus,
    headRef: parsed.headRefName,
    baseRef: parsed.baseRefName,
    statuses,
    ghChecksText: checksText.code === 0 ? limitText(checksText.stdout, 200, 4000) : undefined,
  };
}

function formatRepoContext(context: RepoContext): string {
  return `Branch: ${context.branch}\nBase: ${context.baseBranch}\nStatus:\n${context.statusSummary}\n\nDiff Stat:\n${context.diffStat}\n\nRecent Commits:\n${context.recentCommits}`;
}

function formatPrStatus(summary?: PrStatusSummary | null): string {
  if (!summary) {
    return "No open PR detected (gh pr view failed).";
  }
  const header = summary.number
    ? `PR #${summary.number} (${summary.title ?? "no title"}) [${summary.mergeState ?? "UNKNOWN"}]`
    : "PR status unknown";
  const statuses = summary.statuses.length === 0
    ? "(no checks reported)"
    : summary.statuses
        .map((s) => `- ${s.name}: ${s.status}${s.conclusion ? ` (${s.conclusion})` : ""}`)
        .join("\n");
  return `${header}\nHead: ${summary.headRef ?? "?"} -> Base: ${summary.baseRef ?? "?"}\nChecks:\n${statuses}`;
}

// ---------------------------------------------------------------------------
// PR Deep Reviewer
// ---------------------------------------------------------------------------

class PRDeepReviewer {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig) {
    this.codex = new Codex({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    this.provider = new CodexProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      defaultModel: config.model ?? DEFAULT_MODEL,
      workingDirectory: config.workingDirectory,
      skipGitRepoCheck: config.skipGitRepoCheck,
    });
    this.runner = new Runner({ modelProvider: this.provider });
  }

  async reviewBranch(repoContext: RepoContext, prStatus?: PrStatusSummary | null): Promise<ReviewAnalysis> {
    console.log("🔍 Running codex.review() for branch analysis...");
    const target = repoContext.baseBranch
      ? { type: "branch", baseBranch: repoContext.baseBranch } as const
      : { type: "current_changes" } as const;

    const reviewResult = await this.codex.review({
      target,
      threadOptions: {
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: repoContext.cwd,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        fullAuto: true,
      },
    });

    const contextBlock = formatRepoContext(repoContext);
    const prBlock = formatPrStatus(prStatus);

    const model = await this.provider.getModel();

    const intentionAnalyzer = new Agent({
      name: "IntentionAnalyzer",
      model,
      instructions:
        "Understand developer intent and architecture decisions behind the supplied diff summary.",
    });
    const riskAssessor = new Agent({
      name: "RiskAssessor",
      model,
      instructions: "Enumerate concrete risks, regressions, or rollout concerns for this diff.",
    });
    const qualityReviewer = new Agent({
      name: "QualityReviewer",
      model,
      instructions: "Evaluate code quality, tests, and developer experience improvements to pursue.",
    });

    intentionAnalyzer.handoffs = [handoff(riskAssessor), handoff(qualityReviewer)];
    riskAssessor.handoffs = [handoff(qualityReviewer)];

    const intentionResult = await this.runner.run(
      intentionAnalyzer,
      `Repo context:\n${contextBlock}\n\nPR status:\n${prBlock}\n\nReview summary:\n${reviewResult.finalResponse}\n\nExtract the key intentions and architectural goals in <=8 bullets.`,
    );

    const riskResult = await this.runner.run(
      riskAssessor,
      `Use the same context plus the intention analysis below to map risks.\nIntentions:\n${intentionResult.finalOutput}\n\nList specific risks (with impact+likelihood).`,
    );

    const qualityResult = await this.runner.run(
      qualityReviewer,
      `Context:\n${contextBlock}\n\nReview:\n${reviewResult.finalResponse}\n\nRisks:\n${riskResult.finalOutput}\n\nProvide actionable recommendations (tests to add, refactors, follow-up tasks).`,
    );

    const reviewThread = this.codex.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: repoContext.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
    });

    await reviewThread.run(`You already completed an automated branch review.\n\nBranch: ${repoContext.branch}\nBase: ${repoContext.baseBranch}\n\nRepo signals:\n${contextBlock}\n\nPR status summary:\n${prBlock}\n\nAutomated review findings:\n${reviewResult.finalResponse}\n\nSummarize the most critical insights and propose next investigative steps before I join via TUI.`);

    await reviewThread.run(`Log any CI or QA follow-ups you believe are necessary. You may soon fork to a CI triage agent; acknowledge by replying with a short checklist and the token 'CI-HANDOFF-READY'.`);

    let ciHandoff: Thread | undefined;
    try {
      ciHandoff = await reviewThread.fork({
        nthUserMessage: 1,
        threadOptions: {
          model: this.config.model ?? DEFAULT_MODEL,
          workingDirectory: repoContext.cwd,
          skipGitRepoCheck: this.config.skipGitRepoCheck,
          approvalMode: "on-request",
          sandboxMode: "workspace-write",
        },
      });
    } catch (error) {
      console.warn("⚠️ Unable to fork thread for CI handoff:", error);
    }

    return {
      summary: reviewResult.finalResponse ?? "",
      intentions: extractBullets(intentionResult.finalOutput),
      risks: extractBullets(riskResult.finalOutput),
      recommendations: extractBullets(qualityResult.finalOutput),
      repoContext,
      prStatus,
      thread: reviewThread,
      ciHandoff,
    };
  }

  async launchInteractiveReview(thread: Thread, data: ReviewAnalysis): Promise<NativeTuiExitInfo> {
    const prompt = `PR Review Ready\n\nSummary:\n${data.summary}\n\nIntentions:\n${data.intentions.map((i) => `• ${i}`).join("\n")}\n\nRisks:\n${data.risks.map((r) => `• ${r}`).join("\n")}\n\nRecommendations:\n${data.recommendations.map((r) => `• ${r}`).join("\n")}\n\nEnter the TUI and drill into any file or test you want.`;
    return thread.tui({ prompt, model: this.config.model ?? DEFAULT_MODEL });
  }
}

function extractBullets(text?: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-•*\d]/.test(line))
    .map((line) => line.replace(/^[-•*\d\.\)\s]+/, ""))
    .filter((line) => line.length > 0 && line.length <= 400);
}

// ---------------------------------------------------------------------------
// CI Checker System
// ---------------------------------------------------------------------------

class CICheckerSystem {
  private codex: Codex;
  private provider: CodexProvider;
  private runner: Runner;

  constructor(private readonly config: MultiAgentConfig) {
    this.codex = new Codex({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    this.provider = new CodexProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      defaultModel: DEFAULT_MINI_MODEL,
      workingDirectory: config.workingDirectory,
      skipGitRepoCheck: config.skipGitRepoCheck,
    });
    this.runner = new Runner({ modelProvider: this.provider });
  }

  async checkAndFixCI(
    repoContext: RepoContext,
    prStatus: PrStatusSummary | null,
    ciThread?: Thread,
  ): Promise<CiAnalysis> {
    console.log("🔧 Running CI analysis agents...");
    const model = await this.provider.getModel();
    const ciSignal = `${formatRepoContext(repoContext)}\n\nPR/CI Status:\n${formatPrStatus(prStatus)}\n\nGH checks:\n${prStatus?.ghChecksText ?? "<no gh pr checks output>"}`;

    const lintChecker = new Agent({
      name: "LintChecker",
      model,
      instructions: "Find lint/style/static-analysis risks given the repo + CI signal.",
    });
    const testChecker = new Agent({
      name: "TestChecker",
      model,
      instructions: "Predict unit/integration/e2e failures and missing coverage.",
    });
    const buildChecker = new Agent({
      name: "BuildChecker",
      model,
      instructions: "Detect build/package/dependency or platform issues before CI fails.",
    });
    const securityChecker = new Agent({
      name: "SecurityChecker",
      model,
      instructions: "Highlight security, auth, or secrets issues visible from context.",
    });
    const fixer = new Agent({
      name: "CIFixer",
      model,
      instructions: "Synthesize fixes and ordered remediation plan for the aggregated CI issues.",
    });

    lintChecker.handoffs = [handoff(fixer)];
    testChecker.handoffs = [handoff(fixer)];
    buildChecker.handoffs = [handoff(fixer)];
    securityChecker.handoffs = [handoff(fixer)];

    const prompts = {
      lint: `${ciSignal}\n\nTask: enumerate lint/static-analysis issues likely to fail CI. Include file hints or commands.`,
      test: `${ciSignal}\n\nTask: identify tests likely to fail or be missing. Include pytest/cargo/jest commands.`,
      build: `${ciSignal}\n\nTask: identify build or dependency issues across OS targets.`,
      security: `${ciSignal}\n\nTask: point out security vulnerabilities or secrets hygiene risks in this diff.`,
    };

    const [lintResult, testResult, buildResult, securityResult] = await Promise.all([
      this.runner.run(lintChecker, prompts.lint),
      this.runner.run(testChecker, prompts.test),
      this.runner.run(buildChecker, prompts.build),
      this.runner.run(securityChecker, prompts.security),
    ]);

    const findings = [lintResult, testResult, buildResult, securityResult]
      .map((result) => result?.finalOutput ?? "")
      .join("\n\n");

    const fixerResult = await this.runner.run(
      fixer,
      `${ciSignal}\n\nAggregated findings:\n${findings}\n\nProduce a prioritized remediation checklist with owners and commands.`,
    );

    const issues = extractIssues(fixingsText(findings));
    const fixes = extractBullets(fixerResult.finalOutput);
    const confidence = Math.min(0.99, Math.max(0.2, fixes.length / Math.max(1, issues.length + 2)));

    const thread =
      ciThread ??
      this.codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: repoContext.cwd,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
        approvalMode: "on-request",
        sandboxMode: "workspace-write",
      });

    await thread.run(`CI signal summary as of ${new Date().toISOString()}\n\n${ciSignal}\n\nIssues:\n${issues.map((i) => `• ${i}`).join("\n")}\n\nRecommended fixes:\n${fixes.map((f) => `• ${f}`).join("\n")}\n\nReturn a short confirmation and be ready to continue interactively.`);

    return {
      issues,
      fixes,
      confidence,
      thread,
    };
  }

  async launchInteractiveFixing(thread: Thread, data: CiAnalysis): Promise<NativeTuiExitInfo> {
    const prompt = `CI Analysis\nConfidence: ${(data.confidence * 100).toFixed(1)}%\n\nIssues:\n${data.issues.map((i) => `• ${i}`).join("\n")}\n\nFixes:\n${data.fixes.map((f) => `• ${f}`).join("\n")}\n\nLet's jump into the TUI and apply/validate these fixes.`;
    return thread.tui({ prompt, model: this.config.model ?? DEFAULT_MODEL });
  }
}

function fixingsText(text: string): string {
  return text || "";
}

function extractIssues(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter((line) => /risk|fail|error|issue|break|missing/i.test(line))
    .map((line) => line.replace(/^[-•*\d\.\)\s]+/, "").trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Reverie System Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0, aMag = 0, bMag = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }

  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function extractCompactTextFromRecords(headRecords: string[], tailRecords: string[], insights: string[]): string {
  const texts: string[] = [];

  // Extract from head records
  for (const line of headRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Extract from tail records
  for (const line of tailRecords) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.content || obj?.text;
      if (typeof content === "string" && content.trim()) {
        texts.push(content);
      }
    } catch {
      // ignore parse errors
    }
  }

  // Include insights
  texts.push(...insights);

  // Limit total length to avoid embedding large documents
  const combined = texts.join(" ").slice(0, 4000);
  return combined;
}

// ---------------------------------------------------------------------------
// Reverie System (with embedding re-ranking)
// ---------------------------------------------------------------------------

class ReverieSystem {
  constructor(private readonly config: MultiAgentConfig) {}

  async searchReveries(query: string): Promise<ReverieResult[]> {
    // Prefer native reverie functions if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const native: any = require("@codex-native/sdk");
      if (native && typeof native.reverieSearchConversations === "function") {
        const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
        const results = await native.reverieSearchConversations(codexHome, query, 25);

        // Filter to conversations whose SessionMeta.cwd is inside our workingDirectory
        const projectRoot = path.resolve(this.config.workingDirectory);
        const scoped = (results as any[]).filter((r) => {
          const head: string[] | undefined = r?.conversation?.headRecords;
          if (!Array.isArray(head) || head.length === 0) return false;
          for (const line of head) {
            try {
              const obj = JSON.parse(line);
              const cwd = obj?.meta?.cwd || obj?.cwd; // handle SessionMetaLine vs flattened
              if (typeof cwd === "string") {
                const normalized = path.resolve(cwd);
                if (normalized === projectRoot || normalized.startsWith(projectRoot + path.sep)) {
                  return true;
                }
              }
            } catch {
              // ignore parse errors
            }
          }
          return false;
        });

        // Re-rank with embeddings if embedder is available
        let processed = scoped.map((r) => ({
          conversationId: r.conversation?.id || "unknown",
          timestamp: r.conversation?.createdAt || new Date().toISOString(),
          relevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
          excerpt: (r.matchingExcerpts && r.matchingExcerpts[0]) || "",
          insights: Array.isArray(r.insights) ? r.insights : [],
          // Store raw data for embedding processing
          headRecords: Array.isArray(r.conversation?.headRecords) ? r.conversation.headRecords : [],
          tailRecords: Array.isArray(r.conversation?.tailRecords) ? r.conversation.tailRecords : [],
          rawRelevance: typeof r.relevanceScore === "number" ? r.relevanceScore : 0.7,
        }));

        if (this.config.embedder) {
          try {
            // Get query embedding
            const queryEmbedding = await this.config.embedder.embed(query);

            // Re-rank each result using embeddings
            const reranked = await Promise.all(
              processed.map(async (item) => {
                try {
                  const docText = extractCompactTextFromRecords(
                    item.headRecords,
                    item.tailRecords,
                    item.insights
                  );
                  const docEmbedding = await this.config.embedder!.embed(docText);
                  const semanticScore = cosineSimilarity(queryEmbedding, docEmbedding);

                  // Blend semantic and keyword scores (70% semantic, 30% keyword)
                  const blendedScore = 0.7 * semanticScore + 0.3 * item.rawRelevance;

                  return { ...item, relevance: blendedScore };
                } catch (embedError) {
                  console.warn(`Embedding failed for conversation ${item.conversationId}:`, embedError);
                  return item; // fallback to original relevance
                }
              })
            );

            // Sort by blended relevance score
            reranked.sort((a, b) => b.relevance - a.relevance);
            processed = reranked;
          } catch (embedError) {
            console.warn("Embedding re-ranking failed, using keyword-based ranking:", embedError);
            // Fall back to keyword-based ranking
          }
        }

        // Return top 10 results, remove internal fields
        return processed.slice(0, 10).map(({ headRecords, tailRecords, rawRelevance, ...result }) => result);
      }
    } catch {
      // ignore and fallback
    }

    // Fallback placeholder
    const now = Date.now();
    return [
      {
        conversationId: `reverie-${now}`,
        timestamp: new Date(now).toISOString(),
        relevance: 0.75,
        excerpt: `No native reverie results; placeholder for: ${query}`,
        insights: ["Consider reusing patterns from prior CI fixes."],
      },
    ];
  }

  async injectReverie(thread: Thread, reveries: ReverieResult[], query: string): Promise<void> {
    if (reveries.length === 0) return;
    const note = `Injecting reverie learnings for '${query}':\n${reveries
      .map((r, idx) => `#${idx + 1} (${Math.round(r.relevance * 100)}%): ${r.insights.join("; ")}`)
      .join("\n")}`;
    await thread.run(note);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

class MultiAgentOrchestrator {
  private reviewer: PRDeepReviewer;
  private ciChecker: CICheckerSystem;
  private reverie: ReverieSystem;

  constructor(private readonly config: MultiAgentConfig) {
    this.reviewer = new PRDeepReviewer(config);
    this.ciChecker = new CICheckerSystem(config);
    this.reverie = new ReverieSystem(config);
  }

  async runWorkflow(): Promise<void> {
    console.log("🚀 Multi-Agent Codex Workflow started");
    const repoContext = collectRepoContext(this.config.workingDirectory, this.config.baseBranchOverride);
    const prStatus = collectPrStatus(this.config.workingDirectory);

    let reviewData: ReviewAnalysis | null = null;

    if (this.config.reviewBranch) {
      reviewData = await this.reviewer.reviewBranch(repoContext, prStatus);
      logReviewSummary(reviewData);
      if (this.config.interactive) {
        await this.reviewer.launchInteractiveReview(reviewData.thread, reviewData);
      }
    }

    if (this.config.ciCheck) {
      const ciResult = await this.ciChecker.checkAndFixCI(repoContext, prStatus, reviewData?.ciHandoff);
      logCiSummary(ciResult);
      if (this.config.interactive) {
        await this.ciChecker.launchInteractiveFixing(ciResult.thread, ciResult);
      }
    }

    if (this.config.reverieQuery) {
      const reveries = await this.reverie.searchReveries(this.config.reverieQuery);
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const thread = codex.startThread({
        model: this.config.model ?? DEFAULT_MODEL,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: this.config.skipGitRepoCheck,
      });
      await this.reverie.injectReverie(thread, reveries, this.config.reverieQuery);
      if (this.config.interactive) {
        await thread.tui({
          prompt: `Injected ${reveries.length} reverie insight(s) for '${this.config.reverieQuery}'. Continue the discussion.`,
        });
      }
    }

    if (!this.config.reviewBranch && !this.config.ciCheck && !this.config.reverieQuery) {
      await this.runIntegratedSession(repoContext, prStatus);
    }
  }

  private async runIntegratedSession(repoContext: RepoContext, prStatus: PrStatusSummary | null) {
    const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
    const thread = codex.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: this.config.workingDirectory,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
    });

    const prompt = `Integrated Multi-Agent Session\n\nRepo context:\n${formatRepoContext(repoContext)}\n\nPR status:\n${formatPrStatus(prStatus)}\n\nAvailable commands:\n- type 'review branch' to start automated review\n- type 'check ci' to inspect CI\n- type 'reverie <topic>' to search past insights\n\nHow can I help?`;

    if (this.config.interactive) {
      await thread.tui({ prompt });
    } else {
      const turn = await thread.run(prompt);
      console.log("🤖", turn.finalResponse);
    }
  }
}

function logReviewSummary(data: ReviewAnalysis): void {
  console.log("\n📋 Review Summary");
  console.log("Summary:", data.summary.slice(0, 600), "...\n");
  console.log("Top Intentions:", data.intentions.slice(0, 5));
  console.log("Top Risks:", data.risks.slice(0, 5));
  console.log("Recommendations:", data.recommendations.slice(0, 5));
}

function logCiSummary(data: CiAnalysis): void {
  console.log("\n🔧 CI Summary");
  console.log("Issues:", data.issues.slice(0, 5));
  console.log("Fixes:", data.fixes.slice(0, 5));
  console.log("Confidence:", `${(data.confidence * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// Example: Using with OpenAI Embeddings
// ---------------------------------------------------------------------------

/*
// Example embedder implementation using OpenAI:
// npm install openai

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const config: MultiAgentConfig = {
  workingDirectory: process.cwd(),
  skipGitRepoCheck: true,
  embedder: {
    embed: async (text: string) => {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      return response.data[0].embedding;
    }
  }
};
*/

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(): MultiAgentConfig {
  const args = process.argv.slice(2);
  const config: MultiAgentConfig = {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--review-branch":
        config.reviewBranch = true;
        break;
      case "--ci-check":
        config.ciCheck = true;
        break;
      case "--interactive":
      case "-i":
        config.interactive = true;
        break;
      case "--reverie":
      case "--search":
        config.reverieQuery = args[++i];
        break;
      case "--model":
        config.model = args[++i];
        break;
      case "--base-branch":
        config.baseBranchOverride = args[++i];
        break;
      case "--cwd":
      case "--working-dir":
        config.workingDirectory = path.resolve(args[++i]);
        break;
      case "--api-key":
        config.apiKey = args[++i];
        break;
      case "--base-url":
        config.baseUrl = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith("--")) {
          config.reverieQuery = arg;
        }
        break;
    }
  }

  return config;
}

function printUsage(): void {
  console.log(`
Multi-Agent Codex System
Usage: npx tsx multi-agent-codex-system.ts [options]

Options:
  --review-branch          Run automated branch review before handing to TUI
  --ci-check               Run CI prediction & fixer workflow
  --reverie <query>        Look up prior learnings (placeholder)
  --interactive, -i        Launch TUIs for each stage
  --model <name>           Override default model (default ${DEFAULT_MODEL})
  --base-branch <name>     Override detected base branch
  --cwd <path>             Working directory (default: cwd)
  --api-key <key>          Codex API key
  --base-url <url>         Codex API base URL
  --help                   Show this message
`);
}

async function main(): Promise<void> {
  const config = parseArgs();
  if (config.interactive && (!process.stdout.isTTY || !process.stdin.isTTY)) {
    console.error("❌ Interactive mode requires a TTY terminal.");
    process.exit(1);
  }
  const orchestrator = new MultiAgentOrchestrator(config);
  await orchestrator.runWorkflow();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
}

export {
  MultiAgentOrchestrator,
  PRDeepReviewer,
  CICheckerSystem,
  ReverieSystem,
  type MultiAgentConfig,
  type ReviewAnalysis,
  type CiAnalysis,
  type RepoContext,
};
