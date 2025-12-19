import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const runMock = jest.fn();
const requiresOutputSchemaFileMock = jest.fn(() => false);

jest.unstable_mockModule("../src/exec", () => ({
  CodexExec: jest.fn().mockImplementation(() => ({
    run: runMock,
    requiresOutputSchemaFile: requiresOutputSchemaFileMock,
  })),
}));

jest.unstable_mockModule("../src/nativeBinding", () => ({
  getNativeBinding: () => null,
}));

const { Codex } = await import("../src/codex");

describe("Codex review API", () => {
  beforeEach(() => {
    runMock.mockReset();
    requiresOutputSchemaFileMock.mockReset();
    requiresOutputSchemaFileMock.mockReturnValue(false);
  });

  it("formats structured review output and forwards review hint", async () => {
    const item = { id: "item-1", type: "agent_message", text: "Draft response" };
    const reviewOutput = {
      findings: [
        {
          title: "Missing test coverage",
          body: "Add a unit test for the new conversation flow.",
          confidence_score: 0.72,
          priority: 2,
          code_location: {
            absolute_file_path: "/repo/src/index.ts",
            line_range: { start: 10, end: 12 },
          },
        },
      ],
      overall_correctness: "high",
      overall_explanation: "Review looks solid.",
      overall_confidence_score: 0.9,
    };
    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
    };

    let capturedArgs: any = null;
    runMock.mockImplementation(async function* (args: any) {
      capturedArgs = args;
      yield JSON.stringify({ type: "item.completed", item });
      yield JSON.stringify({ type: "exited_review_mode", review_output: reviewOutput });
      yield JSON.stringify({ type: "turn.completed", usage });
    });

    const codex = new Codex({
      baseUrl: "https://example.com",
      apiKey: "api-key",
      modelProvider: "provider-default",
    });

    const result = await codex.review({
      target: { type: "custom", prompt: "Review this change set.", hint: "custom hint" },
      threadOptions: {
        model: "gpt-review",
        sandboxMode: "read-only",
        approvalMode: "on-request",
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
      },
    });

    expect(capturedArgs).toEqual({
      input: "Review this change set.",
      baseUrl: "https://example.com",
      apiKey: "api-key",
      model: "gpt-review",
      modelProvider: "provider-default",
      oss: undefined,
      sandboxMode: "read-only",
      approvalMode: "on-request",
      workspaceWriteOptions: undefined,
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      outputSchemaFile: undefined,
      outputSchema: undefined,
      fullAuto: undefined,
      review: {
        userFacingHint: "custom hint",
      },
    });

    expect(result.items).toEqual([item]);
    expect(result.usage).toEqual(usage);
    expect(result.finalResponse).toEqual(
      [
        "Review looks solid.",
        "",
        "## Review Findings",
        "",
        "### 1. Missing test coverage",
        "Add a unit test for the new conversation flow.",
        "**Priority:** 2 | **Confidence:** 0.72",
        "**Location:** /repo/src/index.ts:10-12",
        "",
        "",
      ].join("\n"),
    );
  });
});
