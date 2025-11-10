/**
 * Basic Agents runner integration validating our CodexProvider interop with
 * the OpenAI Agents SDK per guides:
 * - https://openai.github.io/openai-agents-js/guides/agents/
 * - https://openai.github.io/openai-agents-js/guides/running-agents/
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();
import {
  startResponsesTestProxy,
  sse,
  responseStarted,
  assistantMessage,
  responseCompleted,
} from "./responsesProxy";



let CodexProvider: any;
beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

describe("Agents Runner + CodexProvider - basic flow", () => {
  it("runs Agent via Runner with CodexProvider and returns final output", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Hello from Agents + Codex!", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const provider = new CodexProvider({
        baseUrl: url,
        skipGitRepoCheck: true,
      });

      const agent = new Agent({
        name: "HelloAgent",
        instructions: "Respond with a friendly greeting.",
      });

      const runner = new Runner({ modelProvider: provider });
      const result = await runner.run(agent, "Say hello");

      expect(result).toBeDefined();
      expect(typeof result.finalOutput).toBe("string");
      expect(result.finalOutput).toContain("Hello");
    } finally {
      await close();
    }
  }, 15000);
});


