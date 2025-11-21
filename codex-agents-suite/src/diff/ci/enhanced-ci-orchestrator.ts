#!/usr/bin/env node

/**
 * Enhanced CI Orchestrator with Auto-Fix Capabilities
 *
 * This orchestrator:
 * 1. Runs CI and detects failures
 * 2. Spawns specialized fix agents using thread forking
 * 3. Actually fixes code (not just describes fixes)
 * 4. Re-runs CI to verify fixes
 * 5. Provides visual tracking of agent progress
 */

import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

import {
  Codex,
  type Thread,
  type ThreadOptions,
  type Usage,
  LspManager,
  type FileDiagnostics,
  type ForkOptions,
} from "@codex-native/sdk";

import { logInfo, logWarn, createThreadLogger } from "../merge/logging.js";
import { TokenTracker } from "../shared/tokenTracker.js";
import { collectRepoSnapshot } from "../shared/snapshot.js";
import { GitRepo } from "../merge/git.js";
import type { RepoSnapshot, CiFailure } from "../merge/types.js";
import { extractCiFailures, derivePathHints } from "../merge/ci.js";

interface CiOrchestratorConfig {
  workingDirectory: string;
  ciCommand?: string[];
  maxIterations?: number;
  coordinatorModel?: string;
  fixerModel?: string;
  reviewerModel?: string;
  baseUrl?: string;
  apiKey?: string;
  visualize?: boolean;
  autoFix?: boolean;
}

interface FixAgent {
  id: string;
  thread: Thread;
  failure: CiFailure;
  status: "pending" | "investigating" | "fixing" | "validating" | "completed" | "failed" | "delegated";
  filesFixed: string[];
  summary?: string;
  attempts: number;
  delegatedTo?: string;
  rejectionReasons: string[];
  tokenTracker: TokenTracker;
}

export class EnhancedCiOrchestrator {
  private codex: Codex;
  private git: GitRepo;
  private lspManager?: LspManager;
  private tokenTracker: TokenTracker;
  private coordinatorThread?: Thread;
  private fixAgents = new Map<string, FixAgent>();
  private currentCiProcess?: ChildProcess;
  private cancelRequested = false;
  private fixIteration = 0;

  constructor(private readonly config: CiOrchestratorConfig) {
    this.codex = new Codex({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.git = new GitRepo(config.workingDirectory);
    this.tokenTracker = new TokenTracker(config.coordinatorModel);
  }

  async run(): Promise<void> {
    logInfo("coordinator", "🚀 Starting Enhanced CI Orchestrator");
    logInfo("coordinator", `Working directory: ${this.config.workingDirectory}`);
    logInfo("coordinator", `Max iterations: ${this.config.maxIterations ?? 5}`);

    // Initialize LSP for better diagnostics
    logInfo("coordinator", "Initializing LSP manager...");
    await this.initializeLsp();

    // Collect initial repository state
    logInfo("coordinator", "Collecting repository snapshot...");
    const snapshot = await collectRepoSnapshot(this.git, [], null);
    logInfo("coordinator", `Branch: ${snapshot.branch ?? "unknown"}`);
    logInfo("coordinator", `Status: ${snapshot.statusShort ? "dirty" : "clean"}`);

    // Start coordinator thread
    logInfo("coordinator", "Starting coordinator thread...");
    await this.initializeCoordinator(snapshot);

    const maxIterations = this.config.maxIterations ?? 5;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.fixIteration = iteration;

      logInfo("coordinator", `\n📍 Iteration ${iteration}/${maxIterations}`);

      // Run CI
      const ciResult = await this.runCi();

      if (ciResult.success) {
        logInfo("coordinator", "✅ CI passed successfully!");

        // Only run final review if we actually fixed things
        if (this.fixAgents.size > 0) {
          await this.runFinalReview(snapshot, true);
        } else {
          logInfo("coordinator", "No fixes were needed - CI passed on first run!");
        }

        this.displayFinalStats();
        await this.cleanup();

        logInfo("coordinator", "✅ CI Orchestrator completed successfully");
        process.exitCode = 0;
        return;
      }

      // Analyze failures
      const failures = await this.analyzeFailures(ciResult.log);

      if (failures.length === 0) {
        logWarn("coordinator", "No actionable failures found");
        break;
      }

      logInfo("coordinator", `Found ${failures.length} failures to fix`);

      // Dispatch fix agents
      const fixResults = await this.dispatchFixAgents(failures);

      if (fixResults === 0) {
        logWarn("coordinator", "No fixes could be applied");
        break;
      }

      logInfo("coordinator", `Applied ${fixResults} fixes, re-running CI...`);
    }

    await this.runFinalReview(snapshot, false);
    this.displayFinalStats();
    await this.cleanup();
    process.exitCode = 1;
  }

  private async initializeLsp(): Promise<void> {
    try {
      this.lspManager = new LspManager({
        workingDirectory: this.config.workingDirectory,
        waitForDiagnostics: true,
      });
      logInfo("coordinator", "LSP manager initialized for enhanced diagnostics");
    } catch (error) {
      logWarn("coordinator", `LSP initialization failed: ${error}`);
    }
  }

  private async initializeCoordinator(snapshot: RepoSnapshot): Promise<void> {
    const threadOptions: ThreadOptions = {
      model: this.config.coordinatorModel ?? "gpt-5.1-codex",
      sandboxMode: "workspace-write",
      approvalMode: "on-request",
      workingDirectory: this.config.workingDirectory,
      skipGitRepoCheck: true,
    };

    this.coordinatorThread = this.codex.startThread(threadOptions);

    // Build shared context that ALL agents will need
    // This creates a common foundation before forking
    const sharedContextPrompt = `# CI Fix Orchestrator - Shared Context

You are coordinating an automated CI fix workflow.

## Repository Context (Shared by all agents)
- **Branch**: ${snapshot.branch ?? "unknown"}
- **Status**: ${snapshot.statusShort || "clean"}
- **Recent commits**:
${snapshot.recentCommits || "none"}

- **Diff stat**:
${snapshot.diffStat || "No changes"}

## Your Role
1. Gather shared context that all fix agents will need
2. Fork specialized agents with this baseline knowledge
3. Each agent gets: shared context + specific failure + relevant reveries
4. Validate fixes and coordinate handoffs

## Workflow Strategy
- **Phase 1**: Establish shared understanding (this step)
- **Phase 2**: Fork agents with shared context + specialized failure details
- **Phase 3**: Agents execute fixes independently
- **Phase 4**: Handoff results back for validation

Ready to begin. I'll dispatch specialized fix agents once CI failures are identified.`;

    const initTurn = await this.coordinatorThread.run(sharedContextPrompt);
    this.tokenTracker.record(initTurn.usage);
    logInfo("coordinator", `Shared context established. Usage: ${(this.tokenTracker.usagePercentage() * 100).toFixed(1)}%`);
  }

  private async runCi(): Promise<{ success: boolean; log: string }> {
    const command = this.config.ciCommand ?? ["pnpm", "run", "ci"];
    const [bin, ...args] = command;

    logInfo("coordinator", `🏃 Running CI command: ${command.join(" ")}`);
    logInfo("coordinator", "This may take a while...");

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd: this.config.workingDirectory,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.currentCiProcess = child;

      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk) => chunks.push(chunk));
      child.stderr?.on("data", (chunk) => chunks.push(chunk));

      child.once("error", (error) => {
        this.currentCiProcess = undefined;
        reject(error);
      });

      child.once("close", (code) => {
        this.currentCiProcess = undefined;
        const log = Buffer.concat(chunks).toString();
        logInfo("coordinator", `CI command finished with exit code: ${code}`);
        resolve({ success: code === 0, log });
      });
    });
  }

  private async analyzeFailures(ciLog: string): Promise<CiFailure[]> {
    // First try to load structured failures from JSON report
    const jsonFailures = this.loadCiJsonReport();
    if (jsonFailures && jsonFailures.length > 0) {
      logInfo("coordinator", `Loaded ${jsonFailures.length} structured failures from CI JSON report`);
      return jsonFailures;
    }

    // Fall back to parsing the log
    const failures = extractCiFailures(ciLog);

    // Enhance with LSP diagnostics if available
    if (this.lspManager) {
      try {
        const changedFiles = await this.getChangedFiles();
        const diagnostics = await this.lspManager.collectDiagnostics(changedFiles);

        for (const fileDiag of diagnostics) {
          if (fileDiag.diagnostics.length > 0) {
            const errorDiagnostics = fileDiag.diagnostics.filter(
              (d) => d.severity === "error",
            );

            if (errorDiagnostics.length > 0) {
              failures.push({
                label: `lsp:${path.basename(fileDiag.path)}`,
                snippet: errorDiagnostics.map((d) => d.message).join("\n"),
                pathHints: [fileDiag.path],
              });
            }
          }
        }
      } catch (error) {
        logWarn("coordinator", `LSP diagnostic collection failed: ${error}`);
      }
    }

    return failures;
  }

  private async dispatchFixAgents(failures: CiFailure[]): Promise<number> {
    if (!this.coordinatorThread) {
      logWarn("coordinator", "No coordinator thread available for forking");
      return 0;
    }

    // Add CI failures summary to coordinator context (shared by all forks)
    const failuresSummary = failures.map((f, idx) =>
      `${idx + 1}. ${f.label}: ${f.snippet?.split('\n')[0] || 'CI check failed'}`
    ).join('\n');

    await this.coordinatorThread.run(`# CI Failures Detected

${failures.length} failures need to be fixed:
${failuresSummary}

I will now fork specialized agents to handle each failure independently.
Each agent will inherit our shared repository context plus their specific failure details.`);

    const agents: FixAgent[] = [];

    for (const failure of failures) {
      const agentId = `fix-${failure.label}-${Date.now()}`;
      const fixerModel = this.config.fixerModel ?? "gpt-5.1-codex";

      let thread: Thread;
      try {
        // Fork from coordinator to inherit shared context
        // This gives agents the baseline knowledge without the full history bloat
        thread = await this.coordinatorThread.fork({
          // Fork from current state (after shared context, before individual failures)
          nthUserMessage: -1, // Last message (includes shared context)
          threadOptions: {
            model: fixerModel,
            sandboxMode: "workspace-write",
            approvalMode: "on-request",
          },
        });

        logInfo("coordinator", `Forked agent for ${failure.label} (inherits shared context)`);

        // Add specialized context: specific failure + relevant reveries
        const specializationPrompt = await this.buildSpecializedContext(failure);
        const specTurn = await thread.run(specializationPrompt);

        // Initialize token tracker with usage from fork + specialization
        const agentTracker = new TokenTracker(fixerModel);
        agentTracker.record(specTurn.usage);
        logInfo("worker", `Specialized context added for ${failure.label}. Usage: ${(agentTracker.usagePercentage() * 100).toFixed(1)}%`);

        const agent: FixAgent = {
          id: agentId,
          thread,
          failure,
          status: "pending",
          filesFixed: [],
          attempts: 0,
          rejectionReasons: [],
          tokenTracker: agentTracker,
        };

        agents.push(agent);
        this.fixAgents.set(agentId, agent);
      } catch (error) {
        logWarn("coordinator", `Failed to fork agent for ${failure.label}: ${error}`);
        continue;
      }
    }

    // Run fix agents in parallel
    const fixPromises = agents.map((agent) => this.runFixAgent(agent));
    const results = await Promise.allSettled(fixPromises);

    // Count successful fixes
    let successCount = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        successCount++;
      }
    }

    // Coordinator rollup review of all agent work
    await this.coordinatorRollupReview(agents);

    return successCount;
  }

  private async coordinatorRollupReview(agents: FixAgent[]): Promise<void> {
    if (!this.coordinatorThread || agents.length === 0) return;

    const completedAgents = agents.filter(a => a.status === "completed");
    const failedAgents = agents.filter(a => a.status === "failed");
    const delegatedAgents = agents.filter(a => a.status === "delegated");

    const rollupPrompt = `# Coordinator Rollup Review

Iteration ${this.fixIteration} complete. Here's the summary of all agent work:

## Completed Fixes (${completedAgents.length})
${completedAgents.map(a => `- ${a.failure.label}: Fixed ${a.filesFixed.length} files
  Summary: ${a.summary}
  ${a.delegatedTo ? `Delegated to: ${a.delegatedTo}` : ''}`).join('\n')}

## Failed Attempts (${failedAgents.length})
${failedAgents.map(a => `- ${a.failure.label}: Failed after ${a.attempts} attempts
  Last rejection: ${a.rejectionReasons[a.rejectionReasons.length - 1] || 'N/A'}`).join('\n')}

## Delegated Tasks (${delegatedAgents.length})
${delegatedAgents.map(a => `- ${a.failure.label} → ${a.delegatedTo || 'specialist'}`).join('\n')}

Please provide:
1. **Overall Assessment**: Are the fixes coherent and safe as a whole?
2. **Conflicts**: Do any fixes potentially conflict with each other?
3. **Missing Fixes**: Are there critical failures we haven't addressed?
4. **Next Steps**: Should we proceed with another CI run or stop?

Respond with your assessment and recommendations.`;

    try {
      // Check if we should fork before running rollup
      if (this.tokenTracker.shouldHandoff()) {
        logWarn("coordinator", `Context ${(this.tokenTracker.usagePercentage() * 100).toFixed(1)}% full - forking coordinator before rollup`);
        await this.forkCoordinator();
      }

      const response = await this.coordinatorThread.run(rollupPrompt);
      this.tokenTracker.record(response.usage);

      const usagePct = (this.tokenTracker.usagePercentage() * 100).toFixed(1);
      logInfo("coordinator", `Context usage: ${usagePct}%`);
      logInfo("coordinator", "📊 Coordinator Rollup Assessment:");
      console.log(response.finalResponse);

      // Check if coordinator recommends stopping
      if (response.finalResponse?.toUpperCase().includes("STOP") ||
          response.finalResponse?.toUpperCase().includes("HALT")) {
        logWarn("coordinator", "Coordinator recommends stopping iterations");
        this.cancelRequested = true;
      }
    } catch (error) {
      logWarn("coordinator", `Rollup review failed: ${error}`);
    }
  }

  private async runFixAgent(agent: FixAgent): Promise<boolean> {
    const { failure } = agent;
    agent.attempts++;

    // Max 3 attempts per agent
    if (agent.attempts > 3) {
      this.updateAgentStatus(agent, "failed");
      logWarn("worker", "Max attempts reached, giving up");
      return false;
    }

    try {
      this.updateAgentStatus(agent, "investigating");

      const prompt = this.buildFixPrompt(failure);

      this.updateAgentStatus(agent, "fixing");

      const turn = await agent.thread.run(prompt);

      // Track token usage
      agent.tokenTracker.record(turn.usage);
      const usagePct = (agent.tokenTracker.usagePercentage() * 100).toFixed(1);
      logInfo("worker", `Token usage: ${agent.tokenTracker.summary()} (${usagePct}% of context)`);

      // Check if we should fork/handoff before continuing
      if (agent.tokenTracker.shouldHandoff()) {
        logWarn("worker", `Context ${usagePct}% full - approaching limit! Consider handoff.`);
      } else if (agent.tokenTracker.shouldFork()) {
        logInfo("worker", `Context ${usagePct}% full - may need to fork soon`);
      }

      // Parse the response to extract fixed files
      const fixedFiles = this.parseFixedFiles(turn.finalResponse ?? "");
      agent.filesFixed = fixedFiles;
      agent.summary = turn.finalResponse ?? "No fix applied";

      if (fixedFiles.length > 0) {
        // Validate the fix with the coordinator
        this.updateAgentStatus(agent, "validating");
        const validation = await this.validateFixWithCoordinator(agent);

        if (validation.approved) {
          this.updateAgentStatus(agent, "completed");
          logInfo("worker", `Fix approved: ${fixedFiles.length} files`);
          return true;
        } else if (validation.delegate) {
          // Handle delegation to specialized agent
          this.updateAgentStatus(agent, "delegated");
          agent.delegatedTo = validation.delegateTo;
          logInfo("worker", `Delegating to ${validation.delegateTo}`);
          return await this.handleDelegation(agent, validation.delegateTo);
        } else {
          // Fix rejected, track reason and try revision
          agent.rejectionReasons.push(validation.reason || "No reason provided");
          logWarn("worker", `Fix rejected: ${validation.reason}`);
          return await this.requestFixRevision(agent);
        }
      } else {
        this.updateAgentStatus(agent, "failed");
        logWarn("worker", "No files were fixed");
        return false;
      }
    } catch (error) {
      this.updateAgentStatus(agent, "failed");
      logWarn("worker", `Agent failed (${failure.label}): ${error}`);
      return false;
    }
  }

  private async validateFixWithCoordinator(agent: FixAgent): Promise<{
    approved: boolean;
    delegate: boolean;
    delegateTo?: string;
    reason?: string;
  }> {
    if (!this.coordinatorThread) {
      return { approved: true, delegate: false }; // Default approve if no coordinator
    }

    const validationPrompt = `# Fix Validation Request

Agent: ${agent.id}
Failure: ${agent.failure.label}
Attempt: ${agent.attempts}/3

Agent's fix summary:
${agent.summary}

Files modified:
${agent.filesFixed.map(f => `- ${f}`).join('\n')}

${agent.rejectionReasons.length > 0 ? `Previous rejection reasons:\n${agent.rejectionReasons.map(r => `- ${r}`).join('\n')}` : ''}

Please review this fix and respond with:
1. **APPROVED** if the fix looks correct and safe
2. **REJECTED:<reason>** if the fix needs revision (explain why)
3. **DELEGATE:<agent-type>** if this should be handled by a different specialist

Consider:
- Does the fix address the root cause?
- Is it minimal and focused?
- Could it break other functionality?
- Are there any risky changes?
- Should we try a different approach after ${agent.attempts} attempts?

Respond with APPROVED, REJECTED:<reason>, or DELEGATE:<agent-type>.`;

    try {
      const response = await this.coordinatorThread.run(validationPrompt);
      const decision = response.finalResponse || "";

      if (decision.toUpperCase().includes("APPROVED")) {
        logInfo("coordinator", `Approved fix for ${agent.failure.label}`);
        return { approved: true, delegate: false };
      } else if (decision.toUpperCase().includes("DELEGATE:")) {
        const match = decision.match(/DELEGATE:\s*([^\s]+)/i);
        const delegateTo = match?.[1] || "specialist";
        logInfo("coordinator", `Delegating ${agent.failure.label} to ${delegateTo}`);
        return { approved: false, delegate: true, delegateTo };
      } else {
        const match = decision.match(/REJECTED:\s*(.+)/i);
        const reason = match?.[1] || response.finalResponse || "No specific reason";
        logInfo("coordinator", `Rejected fix for ${agent.failure.label}: ${reason}`);
        return { approved: false, delegate: false, reason };
      }
    } catch (error) {
      logWarn("coordinator", `Validation failed, auto-approving: ${error}`);
      return { approved: true, delegate: false }; // Default approve on error
    }
  }

  private async handleDelegation(agent: FixAgent, specialistType?: string): Promise<boolean> {
    const specialist = specialistType || "specialist";
    logInfo("coordinator", `Creating ${specialist} agent for ${agent.failure.label}`);

    try {
      // Create specialized agent with enhanced capabilities
      const specialistThread = await this.coordinatorThread?.fork({
        nthUserMessage: 1,
        threadOptions: {
          model: this.config.fixerModel ?? "gpt-5.1-codex",
          sandboxMode: "workspace-write",
          approvalMode: "on-request",
        },
      }) || this.codex.startThread({
        model: this.config.fixerModel ?? "gpt-5.1-codex",
        sandboxMode: "workspace-write",
        approvalMode: "on-request",
        workingDirectory: this.config.workingDirectory,
      });

      const specialistPrompt = `# Specialized Fix Request: ${specialist}

You are a ${specialist} agent called in to fix a challenging CI failure.

Original failure: ${agent.failure.label}
Error snippet: ${agent.failure.snippet}

Previous attempts: ${agent.attempts}
Previous approach that failed:
${agent.summary}

Rejection reasons:
${agent.rejectionReasons.join('\n')}

You have specialized knowledge in ${specialist}. Please:
1. Analyze the problem with your domain expertise
2. Apply a specialized fix that the general agent missed
3. Ensure your fix is robust and correct

Begin your specialized investigation and fix now.`;

      const response = await specialistThread.run(specialistPrompt);

      // Parse specialist's fix
      const fixedFiles = this.parseFixedFiles(response.finalResponse ?? "");

      if (fixedFiles.length > 0) {
        agent.filesFixed = fixedFiles;
        agent.summary = `Specialist (${specialist}): ${response.finalResponse}`;
        agent.delegatedTo = specialist;

        // Validate specialist's fix with coordinator
        const validation = await this.validateFixWithCoordinator(agent);

        if (validation.approved) {
          this.updateAgentStatus(agent, "completed");
          logInfo("coordinator", `Specialist ${specialist} successfully fixed ${agent.failure.label}`);
          return true;
        }
      }

      this.updateAgentStatus(agent, "failed");
      return false;
    } catch (error) {
      logWarn("coordinator", `Specialist ${specialist} failed: ${error}`);
      this.updateAgentStatus(agent, "failed");
      return false;
    }
  }

  private async requestFixRevision(agent: FixAgent): Promise<boolean> {
    // Ask the agent to revise its fix based on coordinator feedback
    const revisionPrompt = `# Fix Revision Required

Your previous fix was rejected by the coordinator.

Previous approach:
${agent.summary}

Please:
1. Review your changes more carefully
2. Consider a different approach
3. Make sure the fix is minimal and safe
4. Try again with a better solution

If you cannot fix this issue, respond with "UNABLE TO FIX" and explain why.`;

    try {
      this.updateAgentStatus(agent, "fixing");
      const revision = await agent.thread.run(revisionPrompt);

      if (revision.finalResponse?.includes("UNABLE TO FIX")) {
        this.updateAgentStatus(agent, "failed");
        return false;
      }

      // Parse revised fix
      const revisedFiles = this.parseFixedFiles(revision.finalResponse ?? "");
      agent.filesFixed = revisedFiles;
      agent.summary = revision.finalResponse ?? "Revision attempted";

      if (revisedFiles.length > 0) {
        // Validate revision with coordinator
        const isApproved = await this.validateFixWithCoordinator(agent);
        if (isApproved) {
          this.updateAgentStatus(agent, "completed");
          return true;
        }
      }

      this.updateAgentStatus(agent, "failed");
      return false;
    } catch (error) {
      this.updateAgentStatus(agent, "failed");
      logWarn("worker", `Revision failed (${agent.failure.label}): ${error}`);
      return false;
    }
  }

  /**
   * Build specialized context for a forked agent
   * Includes: specific failure details + relevant reveries for that failure
   */
  private async buildSpecializedContext(failure: CiFailure): Promise<string> {
    const pathHints = failure.pathHints?.length
      ? `\n- **Suggested paths**: ${failure.pathHints.join(", ")}`
      : "";

    // TODO: Add reverie search here for failure-specific context
    // Example: Search for reveries related to the failing file paths
    // const reveries = await this.searchReveriesForFailure(failure);

    return `# Specialized Context for: ${failure.label}

You are now a specialized fix agent inheriting the shared repository context.

## Your Specific Mission
Fix this CI failure: **${failure.label}**

## Failure Details
${failure.snippet || "No detailed error message available"}${pathHints}

## Your Approach
1. You already know the repo structure and recent commits (from shared context)
2. Focus specifically on fixing **${failure.label}**
3. Use tools to investigate the failure
4. Make minimal, targeted changes
5. Hand off results when complete

## Key Context
- This is ONE of ${this.fixAgents.size + 1} parallel fix efforts
- Stay focused on your specific failure
- Don't make unrelated changes

Ready to investigate and fix this specific issue.`;
  }

  private buildFixPrompt(failure: CiFailure): string {
    const pathHints = failure.pathHints?.length
      ? `Suggested paths: ${failure.pathHints.join(", ")}`
      : "";

    return `# Auto-Fix CI Failure: ${failure.label}

## Your Mission
You are an autonomous CI fixer. Your job is to:
1. Analyze this specific CI failure
2. Find and fix the root cause by editing files
3. Validate your fix makes sense

## CI Failure Details
${failure.snippet || "No snippet available"}
${pathHints}

## Required Actions

1. **Investigate**: Use grep/find to locate the problematic code
2. **Analyze**: Read the failing files and understand the issue
3. **Fix**: Edit files to resolve the problem
4. **Verify**: Run local tests if possible

## Instructions

- Start with: git diff HEAD~1 to see recent changes
- Use grep to find error messages in the code
- Read files carefully before editing
- Make minimal, surgical fixes
- For test failures: fix the test or implementation as appropriate
- For lint issues: apply required formatting
- For type errors: fix types or imports
- For build failures: fix compilation issues

## Fix Guidelines

✅ DO:
- Make focused, minimal changes
- Preserve existing functionality
- Follow existing code patterns
- Add necessary imports
- Fix obvious typos and errors

❌ DON'T:
- Rewrite entire functions unnecessarily
- Change unrelated code
- Remove functionality
- Make risky architectural changes

After fixing, summarize what you changed.

Begin investigating and fixing now.`;
  }

  private parseFixedFiles(response: string): string[] {
    const files: string[] = [];

    // Look for common patterns indicating file edits
    const patterns = [
      /(?:edited?|fixed?|modified?|updated?|changed?)[:\s]+([^\s,]+\.(ts|js|tsx|jsx|rs|py|go|java|cpp|c|h|hpp))/gi,
      /file[:\s]+([^\s,]+\.(ts|js|tsx|jsx|rs|py|go|java|cpp|c|h|hpp))/gi,
    ];

    for (const pattern of patterns) {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !files.includes(match[1])) {
          files.push(match[1]);
        }
      }
    }

    return files;
  }

  private loadCiJsonReport(): CiFailure[] | null {
    const reportPath = path.join(this.config.workingDirectory, ".codex-ci", "ci-report.json");

    if (!fs.existsSync(reportPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(reportPath, "utf8");
      const report = JSON.parse(raw);

      if (!report.results || !Array.isArray(report.results)) {
        return null;
      }

      const failures: CiFailure[] = [];

      for (const job of report.results) {
        if (job.status === "passed") continue;

        // Use parsedFailures if available
        if (job.parsedFailures && Array.isArray(job.parsedFailures)) {
          for (const pf of job.parsedFailures) {
            failures.push({
              label: pf.label || job.name,
              snippet: pf.details || job.failureSummary || "(no details)",
              pathHints: pf.pathHints || [],
            });
          }
        } else {
          // Fall back to basic failure info
          failures.push({
            label: job.name,
            snippet: job.failureSummary || job.stderr?.slice(-1000) || "(no output)",
            pathHints: derivePathHints(job.stderr || job.stdout || "") || [],
          });
        }
      }

      return failures;
    } catch (error) {
      logWarn("coordinator", `Failed to parse CI JSON report: ${error}`);
      return null;
    }
  }

  private async getChangedFiles(): Promise<string[]> {
    try {
      const { stdout: diff } = await this.git.runGit(["diff", "--name-only", "HEAD"]);
      const { stdout: staged } = await this.git.runGit(["diff", "--cached", "--name-only"]);
      const { stdout: untracked } = await this.git.runGit(["ls-files", "--others", "--exclude-standard"]);

      const allFiles = [
        ...diff.split("\n"),
        ...staged.split("\n"),
        ...untracked.split("\n"),
      ].filter(Boolean);

      return [...new Set(allFiles)].map((file) =>
        path.resolve(this.config.workingDirectory, file),
      );
    } catch {
      return [];
    }
  }

  private updateAgentStatus(agent: FixAgent, status: FixAgent["status"]): void {
    agent.status = status;
  }


  private async runFinalReview(snapshot: RepoSnapshot, success: boolean): Promise<void> {
    const reviewThread = this.codex.startThread({
      model: this.config.reviewerModel ?? "gpt-5.1-codex",
      sandboxMode: "read-only",
      approvalMode: "on-request",
      workingDirectory: this.config.workingDirectory,
      skipGitRepoCheck: true,
    });

    const fixSummary = Array.from(this.fixAgents.values())
      .filter((a) => a.status === "completed")
      .map((a) => `- ${a.failure.label}: Fixed ${a.filesFixed.length} files`)
      .join("\n");

    const prompt = `# CI Orchestrator Final Review

Status: ${success ? "✅ All CI checks passing" : "❌ Some CI checks still failing"}

Repository: ${snapshot.branch ?? "unknown"}
Iterations: ${this.fixIteration}

Fixes Applied:
${fixSummary || "No successful fixes"}

Please provide:
1. Summary of what was accomplished
2. Any remaining issues that need manual attention
3. Confidence assessment of the fixes`;

    logInfo("coordinator", "\n📝 Running final review...");
    const review = await reviewThread.run(prompt);

    if (review.finalResponse) {
      logInfo("coordinator", "\n📋 Final Review:");
      console.log(review.finalResponse);
    }
  }

  private displayFinalStats(): void {
    const stats = {
      totalAgents: this.fixAgents.size,
      successful: Array.from(this.fixAgents.values()).filter(
        (a) => a.status === "completed",
      ).length,
      failed: Array.from(this.fixAgents.values()).filter(
        (a) => a.status === "failed",
      ).length,
      filesFixed: Array.from(this.fixAgents.values()).flatMap((a) => a.filesFixed).length,
    };

    logInfo("coordinator", "\n📊 Final Statistics:");
    logInfo("coordinator", `  Total fix agents spawned: ${stats.totalAgents}`);
    logInfo("coordinator", `  Successful fixes: ${stats.successful}`);
    logInfo("coordinator", `  Failed fixes: ${stats.failed}`);
    logInfo("coordinator", `  Total files modified: ${stats.filesFixed}`);
    logInfo("coordinator", `  Token usage: ${this.tokenTracker.summary()}`);
  }

  /**
   * Fork the coordinator thread to a fresh context when approaching limits
   * This preserves continuity while avoiding context window errors
   */
  private async forkCoordinator(): Promise<void> {
    if (!this.coordinatorThread) {
      return;
    }

    try {
      logInfo("coordinator", "Forking coordinator to fresh context...");

      // Fork from a recent message to carry forward key context but drop older history
      const newThread = await this.coordinatorThread.fork({
        // Start from the last few messages instead of full history
        nthUserMessage: -3, // Last 3 user messages
        threadOptions: {
          model: this.config.coordinatorModel ?? "gpt-5.1-codex",
          sandboxMode: "workspace-write",
          approvalMode: "on-request",
        },
      });

      // Replace coordinator thread
      this.coordinatorThread = newThread;

      // Reset token tracker for new context
      this.tokenTracker = new TokenTracker(this.config.coordinatorModel);

      logInfo("coordinator", "✅ Coordinator forked successfully - context refreshed");
    } catch (error) {
      logWarn("coordinator", `Failed to fork coordinator: ${error}`);
    }
  }

  async cleanup(): Promise<void> {
    if (this.lspManager) {
      await this.lspManager.dispose();
    }
  }
}

// CLI entry point
export async function runEnhancedCiOrchestrator(
  workingDirectory = process.cwd(),
  options: Partial<CiOrchestratorConfig> = {},
): Promise<void> {
  const config: CiOrchestratorConfig = {
    workingDirectory,
    ciCommand: ["pnpm", "run", "ci:json"],
    maxIterations: 5,
    coordinatorModel: "gpt-5.1-codex",
    fixerModel: "gpt-5.1-codex",
    reviewerModel: "gpt-5.1-codex",
    visualize: true,
    autoFix: true,
    ...options,
  };

  const orchestrator = new EnhancedCiOrchestrator(config);

  try {
    await orchestrator.run();
  } finally {
    await orchestrator.cleanup();
  }
}

