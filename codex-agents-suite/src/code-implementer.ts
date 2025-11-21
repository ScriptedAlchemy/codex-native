import { Codex, type Thread } from "@codex-native/sdk";
import type { LspDiagnosticsBridge } from "@codex-native/sdk";
import { DEFAULT_MODEL } from "./constants.js";
import { attachApplyPatchReminder } from "./reminders/applyPatchReminder.js";
import type { CiAnalysis, MultiAgentConfig, RepoContext } from "./types.js";

type StartThreadOptions = Parameters<Codex["startThread"]>[0];

type CodeImplementerDeps = {
  startThread(options: StartThreadOptions): Thread;
};

const createDefaultDeps = (config: MultiAgentConfig): CodeImplementerDeps => {
  const codex = new Codex({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  return {
    startThread(options) {
      return codex.startThread(options);
    },
  };
};

class CodeImplementer {
  private deps: CodeImplementerDeps;

  constructor(
    private readonly config: MultiAgentConfig,
    private readonly diagnostics?: LspDiagnosticsBridge,
    deps?: CodeImplementerDeps,
  ) {
    this.deps = deps ?? createDefaultDeps(config);
  }

  async applyFixes(
    repoContext: RepoContext,
    ciResult: CiAnalysis,
  ): Promise<{ thread: Thread; cleanup: () => void }> {
    const thread = this.deps.startThread({
      model: this.config.model ?? DEFAULT_MODEL,
      workingDirectory: repoContext.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      approvalMode: this.config.approvalMode ?? "never",
      sandboxMode: this.config.sandboxMode ?? "danger-full-access",
    });
    const detachDiagnostics = this.diagnostics?.attach(thread);
    const reminderCleanup = attachApplyPatchReminder(thread, this.config.sandboxMode ?? "danger-full-access");
    const instructions = this.buildFixerInstructions(repoContext, ciResult);
    await thread.run(instructions);
    return {
      thread,
      cleanup: () => {
        detachDiagnostics?.();
        reminderCleanup();
      },
    };
  }

  private buildFixerInstructions(repoContext: RepoContext, ciResult: CiAnalysis): string {
    const issuesBlock = ciResult.issues
      .map((issue, idx) => {
        const fileHint = issue.files?.length ? ` Files: ${issue.files.join(", ")}` : "";
        const commandHint = issue.suggestedCommands?.length
          ? ` Commands: ${issue.suggestedCommands.join(" | ")}`
          : "";
        return `#${idx + 1} [${issue.severity}] (${issue.source}) ${issue.title}${fileHint}${commandHint}`;
      })
      .join("\n");
    const fixesBlock = ciResult.fixes
      .map(
        (fix, idx) =>
          `#${idx + 1} [${fix.priority}] ${fix.title} — Steps: ${fix.steps.join(" | ")}`,
      )
      .join("\n");
    return `You are a CI fixer agent operating in ${repoContext.cwd}.
Your task is to apply the remediation steps below by running shell commands and editing files as needed.
For each fix:
1. Run the suggested commands
2. Edit files respecting apply_patch reminders
3. Re-run the relevant CI command to verify
4. Stop after issues are resolved or after reasonable attempts

Repository context:
Branch: ${repoContext.branch}
Base: ${repoContext.baseBranch}

Detected CI issues:
${issuesBlock || "(none)"}

Remediation plan:
${fixesBlock || "(none)"}

Start by summarizing your plan of attack, then begin executing commands.`;
  }
}

export { CodeImplementer };
