import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { ConversationListOptions, ConversationListPage } from "../src/codex";
import type { ThreadOptions } from "../src/threadOptions";
import type { NativeDeleteConversationResult, NativeForkResult } from "../src/nativeBinding";

const listConversationsMock = jest.fn<(request: unknown) => Promise<ConversationListPage>>();
const deleteConversationMock = jest.fn<(request: unknown) => Promise<NativeDeleteConversationResult>>();
const resumeConversationFromRolloutMock = jest.fn<(request: unknown) => Promise<NativeForkResult>>();

jest.unstable_mockModule("../src/exec", () => ({
  CodexExec: jest.fn().mockImplementation(() => ({
    listConversations: listConversationsMock,
    deleteConversation: deleteConversationMock,
    resumeConversationFromRollout: resumeConversationFromRolloutMock,
    run: jest.fn(),
    requiresOutputSchemaFile: () => false,
  })),
}));

jest.unstable_mockModule("../src/nativeBinding", () => ({
  getNativeBinding: () => null,
}));

const { Codex } = await import("../src/codex");

describe("Codex conversation management API", () => {
  beforeEach(() => {
    listConversationsMock.mockReset();
    deleteConversationMock.mockReset();
    resumeConversationFromRolloutMock.mockReset();
  });

  it("listConversations forwards filters and config", async () => {
    const page = {
      conversations: [
        { id: "thread-1", path: "/tmp/thread-1" },
        { id: "thread-2", path: "/tmp/thread-2", createdAt: "2024-01-01T00:00:00Z" },
      ],
      nextCursor: "next",
      numScannedFiles: 12,
      reachedScanCap: false,
    };
    listConversationsMock.mockResolvedValue(page);

    const codex = new Codex({
      defaultModel: "gpt-default",
      baseUrl: "https://example.com",
      apiKey: "api-key",
      modelProvider: "provider-default",
    });

    const options: ConversationListOptions = {
      pageSize: 5,
      cursor: "cursor",
      modelProviders: ["provider-a", "provider-b"],
      model: "gpt-override",
      modelProvider: "provider-override",
      oss: true,
      sandboxMode: "workspace-write",
      approvalMode: "on-request",
      workspaceWriteOptions: { networkAccess: true, writableRoots: ["/tmp"] },
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      reasoningEffort: "high",
      reasoningSummary: "concise",
      fullAuto: true,
    };

    const result = await codex.listConversations(options);

    expect(result).toEqual(page);
    expect(listConversationsMock).toHaveBeenCalledWith({
      config: {
        model: "gpt-override",
        modelProvider: "provider-override",
        oss: true,
        sandboxMode: "workspace-write",
        approvalMode: "on-request",
        workspaceWriteOptions: { networkAccess: true, writableRoots: ["/tmp"] },
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
        reasoningEffort: "high",
        reasoningSummary: "concise",
        fullAuto: true,
        baseUrl: "https://example.com",
        apiKey: "api-key",
      },
      pageSize: 5,
      cursor: "cursor",
      modelProviders: ["provider-a", "provider-b"],
    });
  });

  it("deleteConversation passes config and returns deleted flag", async () => {
    deleteConversationMock.mockResolvedValue({ deleted: true });

    const codex = new Codex({
      defaultModel: "gpt-default",
      baseUrl: "https://example.com",
      apiKey: "api-key",
      modelProvider: "provider-default",
    });

    const options: ThreadOptions = {
      model: "gpt-delete",
      sandboxMode: "read-only",
      approvalMode: "untrusted",
      workspaceWriteOptions: { networkAccess: false, writableRoots: ["/var/tmp"] },
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      reasoningEffort: "low",
      reasoningSummary: "auto",
      fullAuto: false,
    };

    const result = await codex.deleteConversation("thread-1", options);

    expect(result).toBe(true);
    expect(deleteConversationMock).toHaveBeenCalledWith({
      id: "thread-1",
      config: {
        model: "gpt-delete",
        modelProvider: "provider-default",
        oss: undefined,
        sandboxMode: "read-only",
        approvalMode: "untrusted",
        workspaceWriteOptions: { networkAccess: false, writableRoots: ["/var/tmp"] },
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        fullAuto: false,
        baseUrl: "https://example.com",
        apiKey: "api-key",
      },
    });
  });

  it("resumeConversationFromRollout creates a thread with returned id", async () => {
    resumeConversationFromRolloutMock.mockResolvedValue({
      threadId: "thread-42",
      rolloutPath: "/tmp/rollout",
    });

    const codex = new Codex({
      defaultModel: "gpt-default",
      baseUrl: "https://example.com",
      apiKey: "api-key",
    });

    const options: ThreadOptions = {
      model: "gpt-resume",
      sandboxMode: "workspace-write",
      approvalMode: "on-failure",
      workspaceWriteOptions: { networkAccess: true, writableRoots: ["/repo/tmp"] },
      workingDirectory: "/repo",
      skipGitRepoCheck: true,
      reasoningEffort: "minimal",
      reasoningSummary: "none",
      fullAuto: true,
    };

    const thread = await codex.resumeConversationFromRollout("/tmp/rollout", options);

    expect(resumeConversationFromRolloutMock).toHaveBeenCalledWith({
      rolloutPath: "/tmp/rollout",
      config: {
        model: "gpt-resume",
        modelProvider: undefined,
        oss: undefined,
        sandboxMode: "workspace-write",
        approvalMode: "on-failure",
        workspaceWriteOptions: { networkAccess: true, writableRoots: ["/repo/tmp"] },
        workingDirectory: "/repo",
        skipGitRepoCheck: true,
        reasoningEffort: "minimal",
        reasoningSummary: "none",
        fullAuto: true,
        baseUrl: "https://example.com",
        apiKey: "api-key",
      },
    });
    expect(thread.id).toBe("thread-42");
    expect((thread as any)._threadOptions).toEqual(options);
  });
});
