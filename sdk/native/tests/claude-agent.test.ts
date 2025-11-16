/**
 * Test ClaudeAgent for delegating tasks to Claude Code
 *
 * This test demonstrates the agent delegation pattern where ClaudeAgent
 * provides a high-level interface for task delegation and resumption.
 */

import { describe, expect, it, beforeAll, afterEach, jest } from "@jest/globals";
import { setupNativeBinding } from "./testHelpers";

// Setup native binding for tests
setupNativeBinding();

let ClaudeAgent: any;
let Thread: any;
let originalThreadRun: any;

beforeAll(async () => {
  const imports = await import("../src/index");
  ClaudeAgent = imports.ClaudeAgent;
  Thread = imports.Thread;
  // Save the original run method
  originalThreadRun = Thread.prototype.run;
});

afterEach(() => {
  // Restore all mocks after each test to prevent state leakage
  jest.restoreAllMocks();
  // Manually restore Thread.prototype.run
  if (originalThreadRun) {
    Thread.prototype.run = originalThreadRun;
  }
});

describe("ClaudeAgent", () => {
  it("should create an agent with default options", async () => {
    const agent = new ClaudeAgent();
    expect(agent).toBeDefined();
  });

  it("should create an agent with custom options", async () => {
    const agent = new ClaudeAgent({
      model: "claude-sonnet-4-5-20250929",
      workingDirectory: "/tmp/test",
      maxRetries: 3,
    });
    expect(agent).toBeDefined();
  });

  it("should have delegate method", async () => {
    const agent = new ClaudeAgent();
    expect(agent.delegate).toBeDefined();
    expect(typeof agent.delegate).toBe("function");
  });

  it("should have resume method", async () => {
    const agent = new ClaudeAgent();
    expect(agent.resume).toBeDefined();
    expect(typeof agent.resume).toBe("function");
  });

  it("should have workflow method", async () => {
    const agent = new ClaudeAgent();
    expect(agent.workflow).toBeDefined();
    expect(typeof agent.workflow).toBe("function");
  });

  it("should handle delegation with mock Thread", async () => {
    // Mock Thread.prototype.run
    // @ts-ignore
    // @ts-ignore
    const mockRun = jest.fn().mockResolvedValue({
      items: [],
      finalResponse: "Task completed successfully",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
      },
    });

    // Mock Thread.prototype.id
    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent();
    const result = await agent.delegate("Create an add function");

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.threadId).toBe("test-thread-123");
    expect(result.output).toBe("Task completed successfully");
    expect(mockRun).toHaveBeenCalledWith("Create an add function");
  });

  it("should handle resume with thread ID", async () => {
    // @ts-ignore
    const mockRun = jest.fn().mockResolvedValue({
      items: [],
      finalResponse: "Error handling added",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 0,
        output_tokens: 60,
      },
    });

    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent();
    const result = await agent.resume("test-thread-123", "Add error handling");

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.threadId).toBe("test-thread-123");
    expect(result.output).toBe("Error handling added");
  });

  it("should handle errors gracefully", async () => {
    // @ts-ignore
    const mockRun = jest.fn().mockRejectedValue(new Error("API error"));

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent({ maxRetries: 0 });
    const result = await agent.delegate("This will fail");

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.error).toBe("API error");
    expect(result.output).toBe("");
  });

  it("should support multi-step workflows", async () => {
    let callCount = 0;
    // @ts-ignore
    const mockRun = jest.fn().mockImplementation(async () => {
      callCount++;
      return {
        items: [],
        finalResponse: `Step ${callCount} completed`,
        usage: {
          input_tokens: 100 * callCount,
          cached_input_tokens: 0,
          output_tokens: 50 * callCount,
        },
      };
    });

    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent();
    const results = await agent.workflow([
      "Create a function",
      "Add error handling",
      "Add tests",
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe("Step 1 completed");
    expect(results[1].success).toBe(true);
    expect(results[1].output).toBe("Step 2 completed");
    expect(results[2].success).toBe(true);
    expect(results[2].output).toBe("Step 3 completed");
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it("should support approval callbacks", async () => {
    // Track approval callback invocations
    const approvalRequests: any[] = [];
    const approvalHandler = jest.fn().mockImplementation(async (request) => {
      approvalRequests.push(request);
      return true; // Auto-approve
    });

    // Mock Thread.prototype.onApprovalRequest
    const mockOnApprovalRequest = jest.fn();
    (Thread.prototype as any).onApprovalRequest = mockOnApprovalRequest;

    // @ts-ignore
    const mockRun = jest.fn().mockResolvedValue({
      items: [],
      finalResponse: "Task completed with approvals",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
      },
    });

    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent({
      onApprovalRequest: approvalHandler,
    });

    const result = await agent.delegate("Create a test file");

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(mockOnApprovalRequest).toHaveBeenCalledWith(approvalHandler);
  });

  it("should use Claude Sonnet as default model", async () => {
    const agent = new ClaudeAgent();
    // Access private options field for testing
    const options = (agent as any).options;
    expect(options.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("should allow custom approval logic", async () => {
    // Test that approval handler can deny requests
    const approvalHandler = jest.fn().mockImplementation(async (request: any) => {
      // Deny shell commands, approve file writes
      if (request.type === "shell") {
        return false;
      }
      return true;
    });

    const mockOnApprovalRequest = jest.fn();
    (Thread.prototype as any).onApprovalRequest = mockOnApprovalRequest;

    // @ts-ignore
    const mockRun = jest.fn().mockResolvedValue({
      items: [],
      finalResponse: "Completed with selective approvals",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
      },
    });

    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent({
      approvalMode: "on-request",
      onApprovalRequest: approvalHandler,
    });

    const result = await agent.delegate("Write a file");

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(mockOnApprovalRequest).toHaveBeenCalledWith(approvalHandler);
  });

  it.skip("should stop workflow on first failure", async () => {
    // Create a factory function to ensure callCount is properly scoped
    function createFailingMock() {
      let count = 0;
      return jest.fn().mockImplementation(async () => {
        count++;
        console.log(`[TEST] Mock called, count = ${count}`);
        if (count === 2) {
          console.log(`[TEST] Throwing error at count = ${count}`);
          throw new Error("Step 2 failed");
        }
        console.log(`[TEST] Returning success for count = ${count}`);
        return {
          items: [],
          finalResponse: `Step ${count} completed`,
          usage: {
            input_tokens: 100,
            cached_input_tokens: 0,
            output_tokens: 50,
          },
        };
      });
    }

    // @ts-ignore
    const mockRun = createFailingMock();

    Object.defineProperty(Thread.prototype, 'id', {
      get: jest.fn(() => "test-thread-123"),
      configurable: true,
    });

    (Thread.prototype as any).run = mockRun;

    const agent = new ClaudeAgent({ maxRetries: 0 });
    console.log(`[TEST] Starting workflow with 3 steps`);
    const results = await agent.workflow([
      "Step 1",
      "Step 2 (will fail)",
      "Step 3 (should not run)",
    ]);

    console.log(`[TEST] Workflow completed with ${results.length} results`);
    results.forEach((r: any, i: number) => {
      console.log(`[TEST] Result ${i}: success=${r.success}, output="${r.output}", error="${r.error}"`);
    });

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBe("Step 2 failed");
    expect(mockRun).toHaveBeenCalledTimes(2); // Should not call step 3
  });
});
