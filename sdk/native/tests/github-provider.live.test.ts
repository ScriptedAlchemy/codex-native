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

  const runToolCallTest = async (model: string) => {
    ensureCopilotAuth();

    const [{ CodexProvider, codexTool }, { Agent, run }, { z }] = await Promise.all([
      import("../src/index"),
      import("@openai/agents"),
      import("zod"),
    ]);

    const toolName = `get_token_${model.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
    const tokens = new Map<string, string>();
    const calls: string[] = [];

    const tool = codexTool({
      name: toolName,
      description: "Return a unique token for a label.",
      parameters: z.object({ label: z.string() }),
      execute: ({ label }: { label: string }) => {
        const token = `token-${label}-${Math.random().toString(36).slice(2, 8)}`;
        tokens.set(label, token);
        calls.push(label);
        return { label, token };
      },
    });

    const provider = new CodexProvider({
      defaultModel: model,
      modelProvider: "github",
      skipGitRepoCheck: true,
    });

    const agent = new Agent({
      name: `TokenAgent-${model}`,
      model: provider.getModel(model),
      instructions: [
        `Use the ${toolName} tool twice.`,
        `First call with label "first", then with label "second".`,
        `Respond with ONLY this JSON: {"first":"<token>","second":"<token>"}.`,
      ].join(" "),
      tools: [tool],
    });

    const result = await run(agent, "Begin.");
    const output = result.finalOutput;
    if (typeof output !== "string") {
      throw new Error(`Expected string output, got: ${typeof output}`);
    }

    const parsed = parseJsonObject(output);
    expect(tokens.get("first")).toBeTruthy();
    expect(tokens.get("second")).toBeTruthy();
    expect(parsed.first).toBe(tokens.get("first"));
    expect(parsed.second).toBe(tokens.get("second"));
    expect(calls).toEqual(expect.arrayContaining(["first", "second"]));
  };

  it("can run gpt-4.1 via modelProvider='github' using OpenCode auth.json", async () => {
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
    });
    const result = await thread.run("Reply with exactly: OK");
    expect(result.finalResponse).toContain("OK");
  });

  it("streams gpt-4.1 and emits agent_message updates", async () => {
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

    expect(sawUpdate).toBe(true);
    expect(finalText.length).toBeGreaterThan(0);
  });

  it("executes tool calls with gpt-4.1 via CodexProvider + Agents", async () => {
    await runToolCallTest("gpt-4.1");
  });

  it("executes tool calls with gpt-5-mini via CodexProvider + Agents (Responses)", async () => {
    await runToolCallTest("gpt-5-mini");
  });
});
