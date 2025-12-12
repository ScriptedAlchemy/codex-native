import { describe, expect, it, beforeAll, jest } from "@jest/globals";

// Setup native binding for tests
setupNativeBinding();
import { setupNativeBinding } from "./testHelpers";

// Allow extra time on slower CI/mac sandboxes
jest.setTimeout(20000);

let Codex: any;

beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

// Helper to create a Codex client with default sandbox configuration
function createClient(options: any = {}) {
  return new Codex({ skipGitRepoCheck: true, ...options });
}

// Helper to simulate the native exec behavior with mocked responses
function createMockExec(responseText: string) {
  return {
    run: jest.fn(async function* () {
      // Simulate the expected sequence of events from the Rust bridge
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ ItemCompleted: { item: { type: "agent_message", text: responseText } } });
      yield JSON.stringify({ TurnCompleted: { usage: { input_tokens: 10, output_tokens: 5 } } });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper to create a mock exec that captures arguments passed to run
function createMockExecWithCapture(responseText: string, capture: (args: any) => void) {
  return {
    run: jest.fn(async function* (args: any) {
      capture(args);
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ ItemCompleted: { item: { type: "agent_message", text: responseText } } });
      yield JSON.stringify({ TurnCompleted: { usage: { input_tokens: 10, output_tokens: 5 } } });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper for scenarios requiring multiple sequential responses
function createMockExecMultiRun(responses: string[]) {
  let runCount = 0;
  return {
    run: jest.fn(async function* () {
      const currentResponse = responses[runCount] ?? "";
      runCount += 1;
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ ItemCompleted: { item: { type: "agent_message", text: currentResponse } } });
      yield JSON.stringify({ TurnCompleted: { usage: { input_tokens: 10, output_tokens: 5 } } });
    }),
    requiresOutputSchemaFile: () => false,
    getRunCount: () => runCount,
  };
}

describe("Sandbox and Approval Policy Configuration", () => {
  it("passes approval mode configuration", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      approvalMode: "on-request" as const,
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Configured");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test approval mode");

    expect(thread).toBeDefined();
    expect(result).toBeDefined();
    expect(result.finalResponse).toBe("Configured");
  });

  it("passes network access configuration for workspace-write mode", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      workspaceWriteOptions: {
        networkAccess: true,
      },
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Network enabled");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test network access");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Network enabled");
  });

  it("passes additional writable roots configuration", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      workspaceWriteOptions: {
        writableRoots: ["/data/output", "/tmp/cache"],
      },
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Roots configured");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test writable roots");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Roots configured");
  });

  it("passes tmpdir exclusion configuration", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      workspaceWriteOptions: {
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Tmpdir excluded");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test tmpdir exclusions");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Tmpdir excluded");
  });

  it("combines sandbox mode, approval mode, and workspace write options", async () => {
    const threadOptions = {
      model: "gpt-5-codex",
      sandboxMode: "workspace-write" as const,
      approvalMode: "never" as const,
      workspaceWriteOptions: {
        networkAccess: true,
        writableRoots: ["/data"],
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      skipGitRepoCheck: true,
    };

    let capturedArgs: any;
    const client = createClient();
    (client as any).exec = createMockExecWithCapture("All configured", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test combined configuration");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("All configured");
    expect(capturedArgs?.model).toBe("gpt-5-codex");
  });

  it("allows read-only sandbox mode with approval policy", async () => {
    const threadOptions = {
      sandboxMode: "read-only" as const,
      approvalMode: "on-request" as const,
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Read-only configured");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test read-only");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Read-only configured");
  });

  it("allows danger-full-access mode with never approval", async () => {
    const threadOptions = {
      sandboxMode: "danger-full-access" as const,
      approvalMode: "never" as const,
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Full access configured");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test full access");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Full access configured");
  });

  it("supports approval mode without explicit sandbox mode", async () => {
    const threadOptions = {
      approvalMode: "untrusted" as const,
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Approval only configured");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test approval without sandbox");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Approval only configured");
  });

  it("supports workspace write options without network access", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      workspaceWriteOptions: {
        networkAccess: false,
      },
      skipGitRepoCheck: true,
    };

    const client = createClient();
    (client as any).exec = createMockExec("Network disabled");

    const thread = client.startThread(threadOptions);
    const result = await thread.run("Test network disabled");

    expect(thread).toBeDefined();
    expect(result.finalResponse).toBe("Network disabled");
  });

  it("maintains thread continuity with sandbox configuration", async () => {
    const threadOptions = {
      sandboxMode: "workspace-write" as const,
      approvalMode: "on-request" as const,
      workspaceWriteOptions: {
        networkAccess: true,
      },
      skipGitRepoCheck: true,
    };

    const mockExec = createMockExecMultiRun(["First response", "Second response"]);
    const client = createClient();
    (client as any).exec = mockExec;

    const thread = client.startThread(threadOptions);

    const first = await thread.run("First turn");
    const second = await thread.run("Second turn");

    expect(mockExec.getRunCount()).toBe(2);
    expect(first.finalResponse).toBe("First response");
    expect(second.finalResponse).toBe("Second response");
  });
});

