import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, jest } from "@jest/globals";

import { setupNativeBinding } from "./testHelpers";

setupNativeBinding();

jest.setTimeout(120000);

function findOpenCodeAuthPath(): string | null {
  const candidates: string[] = [];
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) {
    candidates.push(path.join(xdg, "opencode", "auth.json"));
  }
  candidates.push(
    path.join(os.homedir(), "Library", "Application Support", "opencode", "auth.json"),
  );
  candidates.push(path.join(os.homedir(), ".local", "share", "opencode", "auth.json"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const shouldRunLive = process.env.CODEX_TEST_LIVE === "1";
const liveDescribe = shouldRunLive ? describe : describe.skip;
const shouldRunLiveTools =
  shouldRunLive &&
  process.env.CODEX_TEST_LIVE_TOOLS === "1" &&
  process.env.CODEX_TEST_LIVE_TOOLS_STRESS === "1";
const liveToolsIt = shouldRunLiveTools ? it : it.skip;

liveDescribe("GitHub Copilot provider (live)", () => {
  const ensureCopilotAuth = () => {
    const authPath = findOpenCodeAuthPath();
    if (!authPath) {
      throw new Error(
        [
          "OpenCode auth.json not found. This live test requires GitHub Copilot login via OpenCode.",
          "Expected one of:",
          "- ${XDG_DATA_HOME}/opencode/auth.json",
          "- ~/Library/Application Support/opencode/auth.json",
          "- ~/.local/share/opencode/auth.json",
        ].join("\n"),
      );
    }

    try {
      const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as Record<string, unknown>;
      if (!raw["github-copilot"] && !raw["github-copilot-enterprise"]) {
        throw new Error(
          "OpenCode auth.json does not contain github-copilot entries. Log in to GitHub Copilot via OpenCode first.",
        );
      }
    } catch (err: unknown) {
      throw new Error(
        `Failed to parse OpenCode auth.json at ${authPath}: ${(err as Error).message}`,
      );
    }
  };

  const parseJsonObject = (value: string): Record<string, string> => {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Expected JSON object in output, got: ${value}`);
    }
    const parsed = JSON.parse(value.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Parsed output is not an object: ${value}`);
    }
    const entries = Object.entries(parsed);
    if (entries.some(([, v]) => typeof v !== "string")) {
      throw new Error(`Expected JSON string values, got: ${value}`);
    }
    return parsed as Record<string, string>;
  };

  const runToolCallTest = async (model: string, labels: string[]) => {
    ensureCopilotAuth();

    const [{ CodexProvider, codexTool }, { Agent, Runner }, { z }] = await Promise.all([
      import("../src/index"),
      import("@openai/agents"),
      import("zod"),
    ]);

    const toolName = `get_token_${model.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
    const tokens = new Map<string, string>();
    const calls: string[] = [];
    const seenLabels = new Set<string>();
    const maxToolCalls = labels.length + 2;
    const doneMarker = "__tool-calls-verified__";

    const tool = codexTool({
      name: toolName,
      description: "Return a unique token for a label.",
      parameters: z.object({ label: z.string() }),
      execute: ({ label }: { label: string }) => {
        calls.push(label);
        seenLabels.add(label);
        if (calls.length > maxToolCalls) {
          throw new Error(`tool recursion guard exceeded: ${calls.length}`);
        }
        let token = tokens.get(label);
        if (!token) {
          token = `token-${label}-${Math.random().toString(36).slice(2, 8)}`;
          tokens.set(label, token);
        }
        if (labels.every((requiredLabel) => seenLabels.has(requiredLabel))) {
          throw new Error(doneMarker);
        }
        return { label, token };
      },
    });

    const provider = new CodexProvider({
      defaultModel: model,
      modelProvider: "github",
      skipGitRepoCheck: true,
      webSearchMode: "disabled",
    });

    const instructions =
      labels.length === 1
        ? [
            `Use the ${toolName} tool once.`,
            `Call with label "${labels[0]}".`,
            `Respond with ONLY this JSON: {"${labels[0]}":"<token>"}.`,
          ].join(" ")
        : [
            `Use the ${toolName} tool twice.`,
            `First call with label "${labels[0]}", then with label "${labels[1]}".`,
            `Respond with ONLY this JSON: {"${labels[0]}":"<token>","${labels[1]}":"<token>"}.`,
          ].join(" ");

    const agent = new Agent({
      name: `TokenAgent-${model}`,
      model: provider.getModel(model),
      instructions,
      tools: [tool],
    });
    const runner = new Runner({ modelProvider: provider });
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 120_000);

    let output: string | null = null;
    try {
      const result = await runner.run(agent, "Begin.", {
        maxTurns: 12,
        signal: controller.signal,
      });
      if (typeof result.finalOutput === "string") {
        output = result.finalOutput;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/max turns|aborted|aborterror|tool recursion guard exceeded|__tool-calls-verified__/i.test(
          message.toLowerCase(),
        )
      ) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
    expect(calls).toEqual(expect.arrayContaining(labels));
    if (output) {
      const parsed = parseJsonObject(output);
      for (const label of labels) {
        expect(tokens.get(label)).toBeTruthy();
        expect(parsed[label]).toBe(tokens.get(label));
      }
    }
  };

  it("rejects gpt-4.1 early for modelProvider='github'", async () => {
    ensureCopilotAuth();

    const { Codex } = await import("../src/index");
    const codex = new Codex({
      defaultModel: "gpt-4.1",
      modelProvider: "github",
    });

    const thread = codex.startThread({
      model: "gpt-4.1",
      modelProvider: "github",
      skipGitRepoCheck: true,
      webSearchMode: "disabled",
    });
    await expect(thread.run("Reply with exactly: OK")).rejects.toThrow(
      /Invalid model "gpt-4\.1".*model provider "github"/i,
    );
  });

  it("streams gpt-5-mini and emits agent_message updates", async () => {
    ensureCopilotAuth();

    const { Codex } = await import("../src/index");
    const codex = new Codex({
      defaultModel: "gpt-5-mini",
      modelProvider: "github",
    });

    const thread = codex.startThread({
      model: "gpt-5-mini",
      modelProvider: "github",
      skipGitRepoCheck: true,
      webSearchMode: "disabled",
    });

    const { events } = await thread.runStreamed("Reply with a short greeting.");

    let sawUpdate = false;
    let finalText = "";

    for await (const event of events) {
      if (event.type === "item.updated" && event.item.type === "agent_message") {
        if (event.item.text.length > 0) {
          sawUpdate = true;
        }
      }
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalText = event.item.text;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
    }

    expect(sawUpdate || finalText.length > 0).toBe(true);
  });

  it("rejects gpt-4.1 tool calls early via CodexProvider + Agents", async () => {
    await expect(runToolCallTest("gpt-4.1", ["first", "second"])).rejects.toThrow(
      /Invalid model "gpt-4\.1".*model provider "github"/i,
    );
  });

  liveToolsIt("executes tool calls with gpt-5-mini via CodexProvider + Agents (Responses)", async () => {
    await runToolCallTest("gpt-5-mini", ["first", "second"]);
  }, 300000);
});
