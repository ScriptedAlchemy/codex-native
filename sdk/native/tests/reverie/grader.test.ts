import { Agent } from "@openai/agents";
import { gradeReverieRelevance, type AgentRunner } from "../../src/reverie/grader";
import type { ReverieInsight } from "../../src/reverie/types";

describe("gradeReverieRelevance", () => {
  it("uses a full Agent instance so runners can access handoffs/tools helpers", async () => {
    const runner: AgentRunner = {
      async run(agent, prompt) {
        expect(prompt).toContain("Context: Investigate CI failures");
        expect(agent).toBeInstanceOf(Agent);
        expect(typeof (agent as Agent).getEnabledHandoffs).toBe("function");
        expect(typeof (agent as Agent).getAllTools).toBe("function");
        return {
          finalOutput: {
            is_relevant: true,
            reasoning: "Mentions concrete test files",
          },
        };
      },
    };

    const insight: ReverieInsight = {
      conversationId: "conv_123",
      timestamp: new Date("2024-05-01T12:00:00Z").toISOString(),
      relevance: 0.92,
      excerpt: "We added retry logic to fix flaky tests in ci/check_runner.ts",
      insights: ["Retry logic fix", "CI stability"],
    };

    const isRelevant = await gradeReverieRelevance(runner, "Investigate CI failures", insight);
    expect(isRelevant).toBe(true);
  });
});
