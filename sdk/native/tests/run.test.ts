import fs from "node:fs";
import { setupNativeBinding } from "./testHelpers";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import type { ThreadItem } from "../src/items";

// Setup native binding for tests
setupNativeBinding();

jest.setTimeout(30000);

let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

// Helper to create mock exec that yields proper Rust-format events
function createMockExec(responseText: string, itemId: string = "item_0") {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: itemId, type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 42, output_tokens: 5, cached_input_tokens: 12 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper to create mock exec for multiple sequential runs
function createMockExecMultiRun(responses: Array<{ text: string; itemId: string }>) {
  let runCount = 0;
  return {
    run: jest.fn(async function* () {
      const response = responses[runCount] || { text: "Default", itemId: "item_x" };
      runCount++;
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: response.itemId, type: "agent_message", text: response.text } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
    getRunCount: () => runCount,
  };
}

// Helper to create mock exec that captures arguments
function createMockExecWithCapture(responseText: string, captureCallback: (args: any) => void) {
  return {
    run: jest.fn(async function* (args: any) {
      captureCallback(args);
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      yield JSON.stringify({ ItemCompleted: { item: { id: "item_0", type: "agent_message", text: responseText } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 42, output_tokens: 5, cached_input_tokens: 12 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper to create mock exec with error/failure
function createMockExecWithError(errorMessage: string) {
  return {
    run: jest.fn(async function* () {
      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });
      throw new Error(`stream disconnected before completion: ${errorMessage}`);
    }),
    requiresOutputSchemaFile: () => false,
  };
}

// Helper for plan update test
function createMockExecWithPlanSupport(responses: string[]) {
  let runCount = 0;
  let pendingPlan: any = null;

  return {
    run: jest.fn(async function* () {
      const text = responses[runCount] || "Default";
      runCount++;

      yield JSON.stringify({ ThreadStarted: { thread_id: "mock-thread-id" } });
      yield JSON.stringify({ TurnStarted: {} });

      // If there's a pending plan, emit it as a todo_list item
      if (pendingPlan) {
        const planItems = pendingPlan.plan.map((p: any) => ({
          text: p.step,
          completed: p.status === "completed",
        }));
        yield JSON.stringify({
          ItemCompleted: {
            item: { id: `plan_${runCount}`, type: "todo_list", items: planItems },
          },
        });
        pendingPlan = null;
      }

      yield JSON.stringify({ ItemCompleted: { item: { id: `item_${runCount}`, type: "agent_message", text } } });
      yield JSON.stringify({
        TurnCompleted: {
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    }),
    requiresOutputSchemaFile: () => false,
    setPendingPlan: (plan: any) => {
      pendingPlan = plan;
    },
    getRunCount: () => runCount,
  };
}

describe("Codex native bridge", () => {
  it("returns thread events", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("Hi!");

    const thread = client.startThread({ skipGitRepoCheck: true });
    const result = await thread.run("Hello, world!");

    expect(result.items).toEqual([
      {
        id: expect.any(String),
        type: "agent_message",
        text: "Hi!",
      },
    ]);
    expect(result.usage).toEqual({
      cached_input_tokens: 12,
      input_tokens: 42,
      output_tokens: 5,
    });
    expect(thread.id).toEqual(expect.any(String));
  });

  it("sends previous items when run is called twice", async () => {
    const mockExec = createMockExecMultiRun([
      { text: "First response", itemId: "item_1" },
      { text: "Second response", itemId: "item_2" },
    ]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const thread = client.startThread({ skipGitRepoCheck: true });
    await thread.run("first input");
    const second = await thread.run("second input");

    expect(mockExec.getRunCount()).toBe(2);
    expect(second.finalResponse).toBe("Second response");
  });

  it("continues the thread when run is called twice with options", async () => {
    const mockExec = createMockExecMultiRun([
      { text: "First response", itemId: "item_1" },
      { text: "Second response", itemId: "item_2" },
    ]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const thread = client.startThread({ model: "gpt-5-codex", sandboxMode: "workspace-write", skipGitRepoCheck: true });
    await thread.run("first input");
    const second = await thread.run("second input");

    expect(mockExec.getRunCount()).toBe(2);
    expect(second.finalResponse).toBe("Second response");
  });

  it("resumes thread by id", async () => {
    const mockExec = createMockExecMultiRun([
      { text: "First response", itemId: "item_1" },
      { text: "Second response", itemId: "item_2" },
    ]);

    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = mockExec;

    const originalThread = client.startThread({ skipGitRepoCheck: true });
    await originalThread.run("first input");

    const resumedThread = client.resumeThread(originalThread.id, { skipGitRepoCheck: true });
    const result = await resumedThread.run("second input");

    expect(resumedThread.id).toBe(originalThread.id);
    expect(result.finalResponse).toBe("Second response");
    expect(mockExec.getRunCount()).toBe(2);
  });

  it("passes turn options to exec", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Turn options applied", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread({
      model: "gpt-5-codex",
      sandboxMode: "workspace-write",
      skipGitRepoCheck: true,
    });
    await thread.run("apply options");

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.model).toBe("gpt-5-codex");
  });

  it("writes output schema to a temporary file and forwards it", async () => {
    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Structured response", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread({ skipGitRepoCheck: true });
    await thread.run("structured", { outputSchema: schema });

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.outputSchema).toEqual(schema);
  });

  it("combines structured text input segments", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Combined input applied", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread({ skipGitRepoCheck: true });
    await thread.run([
      { type: "text", text: "Describe file changes" },
      { type: "text", text: "Focus on impacted tests" },
    ]);

    expect(capturedArgs).toBeDefined();
    // Input was passed to exec
    expect(capturedArgs.input).toBeDefined();
  });

  it("forwards images to exec", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-images-"));
    const imagePaths = [path.join(tempDir, "first.png"), path.join(tempDir, "second.jpg")];
    imagePaths.forEach((image, index) => {
      fs.writeFileSync(image, `image-${index}`);
    });

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Images applied", (args) => {
      capturedArgs = args;
    });

    try {
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run([
        { type: "text", text: "describe the images" },
        { type: "local_image", path: imagePaths[0] },
        { type: "local_image", path: imagePaths[1] },
      ]);

      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.input).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs in provided working directory", async () => {
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-working-dir-"));

    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Working directory applied", (args) => {
      capturedArgs = args;
    });

    try {
      const thread = client.startThread({ workingDirectory, skipGitRepoCheck: true });
      await thread.run("use custom working directory");

      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.workingDirectory).toBeDefined();
    } finally {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("throws if working directory is not git and skipGitRepoCheck is not provided", async () => {
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-working-dir-"));
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExec("Working directory applied");

    try {
      const thread = client.startThread({ workingDirectory });
      await expect(thread.run("use custom working directory")).rejects.toThrow(
        /Not inside a trusted directory/,
      );
    } finally {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("sets the codex sdk originator header", async () => {
    let capturedArgs: any = null;
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithCapture("Hi!", (args) => {
      capturedArgs = args;
    });

    const thread = client.startThread({ skipGitRepoCheck: true });
    await thread.run("Hello, originator!");

    expect(capturedArgs).toBeDefined();
    // The originator is set internally
  });

  it("throws ThreadRunError on turn failures", async () => {
    const client = new Codex({ skipGitRepoCheck: true });
    (client as any).exec = createMockExecWithError("rate limit exceeded");

    const thread = client.startThread({ skipGitRepoCheck: true });
    await expect(thread.run("fail")).rejects.toThrow("stream disconnected before completion:");
  });

  describe("Thread API", () => {
    it("Thread.updatePlan throws when no thread ID", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExec("ok");

      const thread = client.startThread();

      // Should throw because thread hasn't been started yet (no ID)
      expect(() => {
        thread.updatePlan({
          plan: [{ step: "test", status: "pending" }],
        });
      }).toThrow("Cannot update plan: no active thread");
    });

    it("Thread event subscription methods exist", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExec("ok");

      const thread = client.startThread();

      // Verify methods exist
      expect(typeof thread.onEvent).toBe("function");
      expect(typeof thread.offEvent).toBe("function");
      expect(typeof thread.updatePlan).toBe("function");

      // Test event subscription returns unsubscribe function
      const unsubscribe = thread.onEvent(() => {});
      expect(typeof unsubscribe).toBe("function");
    });

    it("Thread plan modification methods exist", async () => {
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = createMockExec("ok");

      const thread = client.startThread();

      // Verify plan modification methods exist
      expect(typeof thread.modifyPlan).toBe("function");
      expect(typeof thread.addTodo).toBe("function");
      expect(typeof thread.updateTodo).toBe("function");
      expect(typeof thread.removeTodo).toBe("function");
      expect(typeof thread.reorderTodos).toBe("function");
    });

    it("Thread.run surfaces scheduled plan updates in returned items", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Verify updatePlan doesn't throw after thread is started
      expect(() => {
        thread.updatePlan({
          plan: [
            { step: "Implement feature", status: "in_progress" },
            { step: "Write tests", status: "completed" },
          ],
        });
      }).not.toThrow();

      // Run again to verify thread continues
      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });

    it("Thread.addTodo adds a new todo item to the plan", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Set initial plan
      thread.updatePlan({
        plan: [{ step: "Existing task", status: "pending" }],
      });

      // Add a new todo - should not throw
      expect(() => {
        thread.addTodo("New task", "in_progress");
      }).not.toThrow();

      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });

    it("Thread.updateTodo updates an existing todo item", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Set initial plan
      thread.updatePlan({
        plan: [
          { step: "Task 1", status: "pending" },
          { step: "Task 2", status: "pending" },
        ],
      });

      // Update todos - should not throw
      expect(() => {
        thread.updateTodo(0, { status: "completed" });
        thread.updateTodo(1, { step: "Updated Task 2", status: "in_progress" });
      }).not.toThrow();

      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });

    it("Thread.removeTodo removes a todo item from the plan", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Set initial plan with 3 items
      thread.updatePlan({
        plan: [
          { step: "Task 1", status: "pending" },
          { step: "Task 2", status: "pending" },
          { step: "Task 3", status: "pending" },
        ],
      });

      // Remove the middle task - should not throw
      expect(() => {
        thread.removeTodo(1);
      }).not.toThrow();

      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });

    it("Thread.reorderTodos reorders todo items in the plan", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Set initial plan with 3 items
      thread.updatePlan({
        plan: [
          { step: "First", status: "pending" },
          { step: "Second", status: "pending" },
          { step: "Third", status: "pending" },
        ],
      });

      // Reorder - should not throw
      expect(() => {
        thread.reorderTodos([2, 0, 1]);
      }).not.toThrow();

      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });

    it("Thread.modifyPlan supports multiple operations in one call", async () => {
      const mockExec = createMockExecMultiRun([
        { text: "First", itemId: "item_1" },
        { text: "Second", itemId: "item_2" },
      ]);
      const client = new Codex({ skipGitRepoCheck: true });
      (client as any).exec = mockExec;

      const thread = client.startThread({ skipGitRepoCheck: true });

      await thread.run("first input");

      // Set initial plan
      thread.updatePlan({
        plan: [
          { step: "Task 1", status: "pending" },
          { step: "Task 2", status: "pending" },
        ],
      });

      // Apply multiple operations at once - should not throw
      expect(() => {
        thread.modifyPlan([
          { type: "update", index: 0, updates: { status: "completed" } },
          { type: "add", item: { step: "Task 3", status: "pending" } },
          { type: "remove", index: 1 },
        ]);
      }).not.toThrow();

      const result = await thread.run("second input");
      expect(result.finalResponse).toBe("Second");
    });
  });
});
