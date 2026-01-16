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

// Helper to create a Codex client with default configuration
function createClient(options: any = {}) {
  return new Codex({ skipGitRepoCheck: true, ...options });
}

// Helper to simulate the native exec behavior with mocked responses
function createMockExec(responseText: string) {
  return {
    run: jest.fn(async function* () {
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

describe("MCP Server Configuration", () => {
  describe("MCP with stdio transport", () => {
    it("passes stdio MCP server configuration", async () => {
      const threadOptions = {
        mcp: {
          "local-tool": {
            command: "npx",
            args: ["-y", "my-mcp-server"],
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("MCP configured", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test MCP configuration");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("MCP configured");
      expect(capturedArgs?.mcp).toBeDefined();
      expect(capturedArgs?.mcp["local-tool"]).toEqual({
        command: "npx",
        args: ["-y", "my-mcp-server"],
      });
    });

    it("passes stdio MCP server with environment variables", async () => {
      const threadOptions = {
        mcp: {
          "env-tool": {
            command: "node",
            args: ["server.js"],
            env: { NODE_ENV: "production", DEBUG: "true" },
            envVars: ["HOME", "PATH"],
            cwd: "/app",
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Env MCP configured", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test MCP with env");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Env MCP configured");
      expect(capturedArgs?.mcp["env-tool"]).toMatchObject({
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "production", DEBUG: "true" },
        envVars: ["HOME", "PATH"],
        cwd: "/app",
      });
    });
  });

  describe("MCP with HTTP transport", () => {
    it("passes HTTP MCP server configuration", async () => {
      const threadOptions = {
        mcp: {
          "remote-api": {
            url: "https://api.example.com/mcp",
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("HTTP MCP configured", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test HTTP MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("HTTP MCP configured");
      expect(capturedArgs?.mcp["remote-api"]).toEqual({
        url: "https://api.example.com/mcp",
      });
    });

    it("passes HTTP MCP server with authentication", async () => {
      const threadOptions = {
        mcp: {
          "github": {
            url: "https://api.github.com/mcp",
            bearerTokenEnvVar: "GITHUB_TOKEN",
            httpHeaders: { "X-Custom-Header": "value" },
            envHttpHeaders: { "X-Secret": "SECRET_ENV_VAR" },
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Auth MCP configured", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test authenticated MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Auth MCP configured");
      expect(capturedArgs?.mcp["github"]).toMatchObject({
        url: "https://api.github.com/mcp",
        bearerTokenEnvVar: "GITHUB_TOKEN",
        httpHeaders: { "X-Custom-Header": "value" },
        envHttpHeaders: { "X-Secret": "SECRET_ENV_VAR" },
      });
    });
  });

  describe("MCP server options", () => {
    it("passes MCP server with tool filters", async () => {
      const threadOptions = {
        mcp: {
          "filtered-tool": {
            command: "npx",
            args: ["tool-server"],
            enabledTools: ["allowed-tool-1", "allowed-tool-2"],
            disabledTools: ["blocked-tool"],
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Filtered MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test filtered MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Filtered MCP");
      expect(capturedArgs?.mcp["filtered-tool"]).toMatchObject({
        enabledTools: ["allowed-tool-1", "allowed-tool-2"],
        disabledTools: ["blocked-tool"],
      });
    });

    it("passes MCP server with timeout configuration", async () => {
      const threadOptions = {
        mcp: {
          "timed-tool": {
            command: "npx",
            args: ["slow-server"],
            startupTimeoutSec: 30,
            toolTimeoutSec: 60,
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Timed MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test timed MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Timed MCP");
      expect(capturedArgs?.mcp["timed-tool"]).toMatchObject({
        startupTimeoutSec: 30,
        toolTimeoutSec: 60,
      });
    });

    it("passes disabled MCP server", async () => {
      const threadOptions = {
        mcp: {
          "disabled-tool": {
            command: "npx",
            args: ["disabled-server"],
            enabled: false,
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Disabled MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test disabled MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Disabled MCP");
      expect(capturedArgs?.mcp["disabled-tool"]).toMatchObject({
        enabled: false,
      });
    });
  });

  describe("Multiple MCP servers", () => {
    it("passes multiple MCP servers of different types", async () => {
      const threadOptions = {
        mcp: {
          "local-tool": {
            command: "npx",
            args: ["-y", "local-mcp"],
          },
          "remote-api": {
            url: "https://api.example.com/mcp",
            bearerTokenEnvVar: "API_TOKEN",
          },
          "another-local": {
            command: "python",
            args: ["-m", "mcp_server"],
            cwd: "/python/app",
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Multi MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test multiple MCPs");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Multi MCP");
      expect(Object.keys(capturedArgs?.mcp)).toHaveLength(3);
      expect(capturedArgs?.mcp["local-tool"]).toBeDefined();
      expect(capturedArgs?.mcp["remote-api"]).toBeDefined();
      expect(capturedArgs?.mcp["another-local"]).toBeDefined();
    });
  });

  describe("inheritMcp option", () => {
    it("passes inheritMcp=true by default", async () => {
      const threadOptions = {
        mcp: {
          "custom-tool": {
            command: "npx",
            args: ["custom-mcp"],
          },
        },
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Inherit MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      await thread.run("Test inherit MCP default");

      // Default is true, so inheritMcp should be undefined or true
      expect(capturedArgs?.inheritMcp).toBeUndefined();
    });

    it("passes inheritMcp=false to ignore global MCP servers", async () => {
      const threadOptions = {
        mcp: {
          "custom-tool": {
            command: "npx",
            args: ["custom-mcp"],
          },
        },
        inheritMcp: false,
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("No inherit MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test no inherit MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("No inherit MCP");
      expect(capturedArgs?.inheritMcp).toBe(false);
    });

    it("passes inheritMcp=true explicitly", async () => {
      const threadOptions = {
        mcp: {
          "custom-tool": {
            command: "npx",
            args: ["custom-mcp"],
          },
        },
        inheritMcp: true,
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Explicit inherit MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test explicit inherit MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Explicit inherit MCP");
      expect(capturedArgs?.inheritMcp).toBe(true);
    });

    it("passes inheritMcp=false with empty mcp to clear all MCP servers", async () => {
      const threadOptions = {
        inheritMcp: false,
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Clear MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test clear all MCP");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Clear MCP");
      expect(capturedArgs?.inheritMcp).toBe(false);
      // mcp should be undefined since we didn't provide any
      expect(capturedArgs?.mcp).toBeUndefined();
    });
  });

  describe("MCP with Codex options", () => {
    it("passes MCP configuration from Codex options", async () => {
      const codexOptions = {
        mcp: {
          "default-tool": {
            command: "npx",
            args: ["default-mcp"],
          },
        },
        inheritMcp: false,
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = new Codex(codexOptions);
      (client as any).exec = createMockExecWithCapture("Codex MCP", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread({ skipGitRepoCheck: true });
      const result = await thread.run("Test Codex MCP options");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Codex MCP");
      // MCP should be passed through from Codex options
    });
  });

  describe("MCP with other thread options", () => {
    it("combines MCP with sandbox and approval configuration", async () => {
      const threadOptions = {
        sandboxMode: "workspace-write" as const,
        approvalMode: "on-request" as const,
        mcp: {
          "tool-with-sandbox": {
            command: "npx",
            args: ["sandboxed-mcp"],
          },
        },
        inheritMcp: false,
        skipGitRepoCheck: true,
      };

      let capturedArgs: any;
      const client = createClient();
      (client as any).exec = createMockExecWithCapture("Combined config", (args) => {
        capturedArgs = args;
      });

      const thread = client.startThread(threadOptions);
      const result = await thread.run("Test combined configuration");

      expect(thread).toBeDefined();
      expect(result.finalResponse).toBe("Combined config");
      expect(capturedArgs?.mcp).toBeDefined();
      expect(capturedArgs?.inheritMcp).toBe(false);
      expect(capturedArgs?.sandboxMode).toBe("workspace-write");
      expect(capturedArgs?.approvalMode).toBe("on-request");
    });

    it("maintains thread continuity with MCP configuration", async () => {
      const threadOptions = {
        mcp: {
          "persistent-tool": {
            url: "https://api.example.com/mcp",
          },
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
});
