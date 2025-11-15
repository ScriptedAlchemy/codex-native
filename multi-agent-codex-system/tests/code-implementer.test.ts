import test from "node:test";
import assert from "node:assert/strict";
import type { Thread } from "@codex-native/sdk";
import { CodeImplementer } from "../src/code-implementer.js";
import type { CiAnalysis, MultiAgentConfig, RepoContext } from "../src/types.js";

function createConfig(): MultiAgentConfig {
  return {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    implementFixes: true,
  };
}

test("CodeImplementer seeds fixer thread with remediation plan", async () => {
  const prompts: string[] = [];
  const threadStub = {
    async run(prompt: string) {
      prompts.push(prompt);
      return {};
    },
    onEvent() {
      return () => {};
    },
    async sendBackgroundEvent() {
      return {};
    },
  } as unknown as Thread;

  const repoContext: RepoContext = {
    cwd: "/repo",
    branch: "feature",
    baseBranch: "main",
    statusSummary: "clean",
    diffStat: "1 file",
    diffSample: "---",
    recentCommits: "abc",
  };

  const ciResult: CiAnalysis = {
    issues: [
      {
        source: "lint",
        severity: "P1",
        title: "format failing",
        summary: "cargo fmt complains",
        files: ["foo.rs"],
        suggestedCommands: ["cargo fmt"],
      },
    ],
    fixes: [
      {
        priority: "P1",
        title: "Run cargo fmt",
        steps: ["cargo fmt", "commit"],
        owner: "dev",
      },
    ],
    confidence: 0.5,
    thread: threadStub,
  };

  const implementer = new CodeImplementer(createConfig(), undefined, {
    startThread: () => threadStub,
  });

  const { thread, cleanup } = await implementer.applyFixes(repoContext, ciResult);
  assert.equal(thread, threadStub);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes("format failing"));
  assert.ok(prompts[0].includes("Run cargo fmt"));

  cleanup();
  assert.ok(true, "cleanup completes without throwing");
});
