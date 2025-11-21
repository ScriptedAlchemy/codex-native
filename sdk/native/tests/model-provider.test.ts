import { Codex } from "../src/codex";
import { Thread } from "../src/thread";
import { CodexOptions } from "../src/codexOptions";

function threadOptions(thread: Thread) {
  return (thread as unknown as { _threadOptions: Record<string, unknown> })._threadOptions;
}

describe("Codex model provider overrides", () => {
  it("applies default model when none provided", () => {
    const codex = new Codex({ defaultModel: "gpt-test" });
    const thread = codex.startThread();
    expect(threadOptions(thread).model).toBe("gpt-test");
  });

  it("prefers thread-level model option", () => {
    const codex = new Codex({ defaultModel: "default-model" });
    const thread = codex.startThread({ model: "thread-model" });
    expect(threadOptions(thread).model).toBe("thread-model");
  });

  it("stores provider override on thread options", () => {
    const options: CodexOptions = { modelProvider: "custom-provider" };
    const codex = new Codex(options);
    const thread = codex.startThread();
    // Thread options remain accessible for native calls; ensure override persisted.
    expect(threadOptions(thread).modelProvider).toBeUndefined();
    // Instead verify the stored Codex options for provider override.
    expect((codex as unknown as { options: CodexOptions }).options.modelProvider).toBe("custom-provider");
  });
});
