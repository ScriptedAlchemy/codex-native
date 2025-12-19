import { setupNativeBinding } from "./testHelpers";

import { beforeAll, describe, expect, it, jest } from "@jest/globals";

setupNativeBinding();

jest.setTimeout(30000);

let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

function createMockExecWithCapture(responseText: string, captureCallback: (args: any) => void) {
  return {
    run: jest.fn(async function* (args: any) {
      captureCallback(args);
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({
        ItemCompleted: { item: { id: "item_0", type: "agent_message", text: responseText } },
      });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

describe("skills", () => {
  it("sends skill_inline items for codex-level registered skills when mentioned", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("ok", (args) => {
      capturedArgs = args;
    });

    client.registerSkill({ name: "demo", contents: "You are the demo skill." });
    const thread = client.startThread({ skipGitRepoCheck: true });

    await thread.run("Use $demo to answer succinctly.");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.inputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill_inline",
          name: "demo",
          contents: "You are the demo skill.",
        }),
      ]),
    );
    expect(capturedArgs.images).toBeUndefined();
  });

  it("supports thread-local skill registration via ThreadOptions.skills", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("ok", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread({
      skipGitRepoCheck: true,
      skills: { "thread-skill": "Thread-only instructions." },
    });

    await thread.run("Please apply $thread-skill.");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.inputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill_inline",
          name: "thread-skill",
          contents: "Thread-only instructions.",
        }),
      ]),
    );
  });

  it("supports @skill mentions when enabled via skillMentionTriggers", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true, skillMentionTriggers: ["@"] });
    (client as any).exec = createMockExecWithCapture("ok", (args) => {
      capturedArgs = args;
    });

    client.registerSkill({ name: "mention", contents: "Mention via @." });
    const thread = client.startThread({ skipGitRepoCheck: true });

    await thread.run("Use @mention now.");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.inputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill_inline",
          name: "mention",
          contents: "Mention via @.",
        }),
      ]),
    );
  });
});

