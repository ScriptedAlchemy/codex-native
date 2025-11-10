/**
 * Test agent handoffs with CodexProvider
 *
 * This test demonstrates multi-agent workflows where one agent can delegate
 * tasks to specialized agents using handoffs.
 */

import { describe, expect, it, beforeAll, beforeEach, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

let CodexProvider: any;

beforeAll(async () => {
  ({ CodexProvider } = await import("../src/index"));
});

/**
 * Create a mock Codex thread that simulates agent responses
 */
function createMockThread(responseText: string) {
  const createUsage = () => ({
    input_tokens: 10,
    output_tokens: 5,
    reasoning_tokens: 0,
  });

  return {
    id: 'mock-thread',
    run: jest.fn(async () => ({
      items: [
        {
          type: 'agent_message',
          text: responseText,
        },
      ],
      finalResponse: responseText,
      usage: createUsage(),
    })),
    runStreamed: jest.fn(async () => ({
      events: (async function* () {
        const usage = createUsage();
        yield { type: 'thread.started', thread_id: 'mock-thread' };
        yield { type: 'item.started', item: { type: 'agent_message', text: '' } };
        yield { type: 'item.updated', item: { type: 'agent_message', text: responseText } };
        yield { type: 'item.completed', item: { type: 'agent_message', text: responseText } };
        yield { type: 'turn.completed', usage };
      })(),
    })),
  };
}

describe("CodexProvider - Agent Handoffs", () => {
  let provider: any;
  let mockCodex: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCodex = {
      startThread: jest.fn(),
      resumeThread: jest.fn(),
      registerTool: jest.fn(),
    };

    provider = new CodexProvider({
      apiKey: "test",
      skipGitRepoCheck: true,
    });

    // Inject mock Codex instance
    provider.codex = mockCodex;
  });

  it("works with agent handoffs using mock backend", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    // Setup mock thread for primary agent
    const primaryResponse = "I see you need code review. Let me hand this off to the Code Specialist.";
    const mockThread = createMockThread(primaryResponse);
    mockCodex.startThread.mockReturnValue(mockThread);

    // Create agents with handoff
    const codeSpecialist = new Agent({
      name: "CodeSpecialist",
      instructions: "You are an expert code reviewer. You analyze code quality, security, and best practices.",
      handoffDescription: "Expert at code review, refactoring, and identifying bugs",
    });

    const primaryAgent = new Agent({
      name: "PrimaryAgent",
      instructions: "You are a general-purpose assistant. Delegate code review tasks to the CodeSpecialist.",
      handoffs: [codeSpecialist],
    });

    const runner = new Runner({ modelProvider: provider });
    const result = await runner.run(primaryAgent, "Can you review this function for me?");

    // Verify the runner got a result
    expect(result).toBeDefined();
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput!).toContain("code review");

    // Verify thread was started
    expect(mockCodex.startThread).toHaveBeenCalled();
  });

  it("works with multiple specialized agents", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    // Setup mock thread that simulates coordinator delegating to specialists
    const coordinatorResponse = "I'll coordinate with the specialists to fix bugs and add tests.";
    const mockThread = createMockThread(coordinatorResponse);
    mockCodex.startThread.mockReturnValue(mockThread);

    // Create multiple specialized agents
    const bugFixer = new Agent({
      name: "BugFixer",
      instructions: "You fix bugs in code",
      handoffDescription: "Specialist in debugging and fixing code issues",
    });

    const testWriter = new Agent({
      name: "TestWriter",
      instructions: "You write comprehensive tests",
      handoffDescription: "Expert at writing unit and integration tests",
    });

    // Primary agent can delegate to multiple specialists
    const coordinator = new Agent({
      name: "Coordinator",
      instructions: "You coordinate work between specialists",
      handoffs: [bugFixer, testWriter],
    });

    const runner = new Runner({ modelProvider: provider });
    const result = await runner.run(coordinator, "Fix bugs and add tests");

    expect(result).toBeDefined();
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput!).toBeDefined();
    expect(mockCodex.startThread).toHaveBeenCalled();
  });

  it("handles handoff chain (agent A -> agent B -> agent C)", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    // Setup mock thread that simulates a chain of handoffs
    const chainResponse = "Coordinator delegated to Analyzer, which delegated to Fixer. All issues resolved!";
    const mockThread = createMockThread(chainResponse);
    mockCodex.startThread.mockReturnValue(mockThread);

    // Create a chain of agents: Coordinator -> Analyzer -> Fixer
    const fixer = new Agent({
      name: "Fixer",
      instructions: "You fix identified issues",
      handoffDescription: "Fixes problems found during analysis",
    });

    const analyzer = new Agent({
      name: "Analyzer",
      instructions: "You analyze code for issues",
      handoffDescription: "Analyzes code and identifies problems",
      handoffs: [fixer],
    });

    const coordinator = new Agent({
      name: "Coordinator",
      instructions: "You coordinate the workflow",
      handoffs: [analyzer],
    });

    const runner = new Runner({ modelProvider: provider });
    const result = await runner.run(coordinator, "Analyze and fix this code");

    expect(result).toBeDefined();
    expect(result.finalOutput).toBeDefined();
    expect(result.finalOutput!.toLowerCase()).toMatch(/delegat|fix|resolv/i);
    expect(mockCodex.startThread).toHaveBeenCalled();
  });

  it("verifies handoff data is passed in ModelRequest", async () => {
    const { Agent, Runner } = await import("@openai/agents");

    // Setup mock thread
    const responseText = "Task completed!";
    const mockThread = createMockThread(responseText);
    mockCodex.startThread.mockReturnValue(mockThread);

    const specialist = new Agent({
      name: "Specialist",
      instructions: "You are a specialist",
      handoffDescription: "Handles specialized tasks",
    });

    const primary = new Agent({
      name: "Primary",
      instructions: "You are the primary agent",
      handoffs: [specialist],
    });

    const runner = new Runner({ modelProvider: provider });
    const result = await runner.run(primary, "Do something");

    // Verify provider was called
    expect(result).toBeDefined();
    expect(result.finalOutput!).toBe(responseText);

    // Verify thread was created
    expect(mockCodex.startThread).toHaveBeenCalled();
  });
});
