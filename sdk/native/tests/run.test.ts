import fs from "node:fs";
import { setupNativeBinding } from "./testHelpers";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeAll, jest } from "@jest/globals";
import type { ThreadItem } from "../src/items";

// Setup native binding for tests
setupNativeBinding();

jest.setTimeout(30000);

import {
  assistantMessage,
  responseCompleted,
  responseStarted,
  sse,
  responseFailed,
  startResponsesTestProxy,
} from "./responsesProxy";



let Codex: any;
beforeAll(async () => {
  ({ Codex } = await import("../src/index"));
});

function createClient(baseUrl: string) {
  return new Codex({ baseUrl, apiKey: "test", skipGitRepoCheck: true });
}

describe("Codex native bridge", () => {
  it("returns thread events", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("Hi!"), responseCompleted())],
    });

    try {
      const client = createClient(url);
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
    } finally {
      await close();
    }
  });

  it("sends previous items when run is called twice", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run("first input");
      await thread.run("second input");

      expect(requests.length).toBeGreaterThanOrEqual(2);
      const secondRequest = requests[1]!;
      const assistantEntry = secondRequest.json.input.find((entry: any) => entry.role === "assistant");
      const assistantText = assistantEntry?.content?.find((item: any) => item.type === "output_text")?.text;
      expect(assistantText).toBe("First response");
      const lastUser = secondRequest.json.input.at(-1);
      expect(lastUser?.content?.[0]?.text).toBe("second input");
    } finally {
      await close();
    }
  });

  it("continues the thread when run is called twice with options", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ model: "gpt-5-codex", sandboxMode: "workspace-write", skipGitRepoCheck: true });
      await thread.run("first input");
      await thread.run("second input");

      expect(requests.length).toBeGreaterThanOrEqual(2);
      const payload = requests[1]!.json;
      const assistantEntry = payload.input.find((entry: any) => entry.role === "assistant");
      const assistantText = assistantEntry?.content?.find((item: any) => item.type === "output_text")?.text;
      expect(assistantText).toBe("First response");
      expect(payload.model).toBe("gpt-5-codex");
      const lastUser = payload.input.at(-1);
      expect(lastUser?.content?.[0]?.text).toBe("second input");
      expect(JSON.stringify(payload)).toContain("workspace-write");
    } finally {
      await close();
    }
  });

  it("resumes thread by id", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("First response", "item_1"),
          responseCompleted("response_1"),
        ),
        sse(
          responseStarted("response_2"),
          assistantMessage("Second response", "item_2"),
          responseCompleted("response_2"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const originalThread = client.startThread({ skipGitRepoCheck: true });
      await originalThread.run("first input");

      const resumedThread = client.resumeThread(originalThread.id, { skipGitRepoCheck: true });
      const result = await resumedThread.run("second input");

      expect(resumedThread.id).toBe(originalThread.id);
      expect(result.finalResponse).toBe("Second response");

      expect(requests.length).toBeGreaterThanOrEqual(2);
      const assistantEntry = requests[1]!.json.input.find((entry: any) => entry.role === "assistant");
      const assistantText = assistantEntry?.content?.find((item: any) => item.type === "output_text")?.text;
      expect(assistantText).toBe("First response");
    } finally {
      await close();
    }
  });

  it("passes turn options to exec", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Turn options applied", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({
        model: "gpt-5-codex",
        sandboxMode: "workspace-write",
        skipGitRepoCheck: true,
      });
      await thread.run("apply options");

      const payload = requests[0]!.json;
      expect(payload.model).toBe("gpt-5-codex");
    } finally {
      await close();
    }
  });

  it("writes output schema to a temporary file and forwards it", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Structured response", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    const schema = {
      type: "object",
      properties: {
        answer: { type: "string" },
      },
      required: ["answer"],
      additionalProperties: false,
    };

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run("structured", { outputSchema: schema });

      const payload = requests[0]!.json;
      expect(payload.text?.format).toEqual({
        name: "codex_output_schema",
        type: "json_schema",
        strict: true,
        schema,
      });
    } finally {
      await close();
    }
  });

  it("combines structured text input segments", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Combined input applied", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run([
        { type: "text", text: "Describe file changes" },
        { type: "text", text: "Focus on impacted tests" },
      ]);

      const payload = requests[0]!.json;
      const lastUser = payload.input.at(-1);
      expect(lastUser?.content?.[0]?.text).toBe("Describe file changes\n\nFocus on impacted tests");
    } finally {
      await close();
    }
  });

  it("forwards images to exec", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Images applied", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-images-"));
    const imagePaths = [path.join(tempDir, "first.png"), path.join(tempDir, "second.jpg")];
    imagePaths.forEach((image, index) => {
      fs.writeFileSync(image, `image-${index}`);
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run([
        { type: "text", text: "describe the images" },
        { type: "local_image", path: imagePaths[0] },
        { type: "local_image", path: imagePaths[1] },
      ]);

      const payload = requests[0]?.json;
      const lastEntry = payload?.input?.at(-1);
      expect(lastEntry?.content?.filter((item: any) => item.type === "input_image")).toHaveLength(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await close();
    }
  });

  it("runs in provided working directory", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Working directory applied", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-working-dir-"));

    try {
      const client = createClient(url);
      const thread = client.startThread({ workingDirectory, skipGitRepoCheck: true });
      await thread.run("use custom working directory");

      const envContext = requests[0]?.json?.input?.[0]?.content?.[0]?.text ?? "";
      const resolvedDirectory = fs.realpathSync(workingDirectory);
      expect(envContext).toContain(`<cwd>${resolvedDirectory}</cwd>`);
    } finally {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
      await close();
    }
  });

it("throws if working directory is not git and skipGitRepoCheck is not provided", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(
          responseStarted("response_1"),
          assistantMessage("Working directory applied", "item_1"),
          responseCompleted("response_1"),
        ),
      ],
    });

    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-working-dir-"));

    try {
      const client = createClient(url);
      const thread = client.startThread({ workingDirectory });
      await expect(thread.run("use custom working directory")).rejects.toThrow(
        /Not inside a trusted directory/,
      );
    } finally {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
      await close();
    }
});

  it("sets the codex sdk originator header", async () => {
    const { url, close, requests } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [sse(responseStarted(), assistantMessage("Hi!"), responseCompleted())],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await thread.run("Hello, originator!");

      expect(requests.length).toBeGreaterThan(0);
      const originatorHeader = requests[0]!.headers["originator"];
      expect(["codex_sdk_native", "codex_exec"]).toContain(originatorHeader);
    } finally {
      await close();
    }
  });
  it("throws ThreadRunError on turn failures", async () => {
    const { url, close } = await startResponsesTestProxy({
      statusCode: 200,
      responseBodies: [
        sse(responseStarted("response_1")),
        sse(responseFailed("rate limit exceeded")),
      ],
    });

    try {
      const client = createClient(url);
      const thread = client.startThread({ skipGitRepoCheck: true });
      await expect(thread.run("fail")).rejects.toThrow("stream disconnected before completion:");
    } finally {
      await close();
    }
  }, 10000);

  describe("Thread API", () => {
    it("Thread.updatePlan throws when no thread ID", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [sse(responseStarted(), assistantMessage("ok"), responseCompleted())],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread();

        // Should throw because thread hasn't been started yet (no ID)
        expect(() => {
          thread.updatePlan({
            plan: [{ step: "test", status: "pending" }]
          });
        }).toThrow("Cannot update plan: no active thread");
      } finally {
        await close();
      }
    });

    it("Thread event subscription methods exist", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [sse(responseStarted(), assistantMessage("ok"), responseCompleted())],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread();

        // Verify methods exist
        expect(typeof thread.onEvent).toBe("function");
        expect(typeof thread.offEvent).toBe("function");
        expect(typeof thread.updatePlan).toBe("function");

        // Test event subscription returns unsubscribe function
        const unsubscribe = thread.onEvent(() => {});
        expect(typeof unsubscribe).toBe("function");
      } finally {
        await close();
      }
    });

    it("Thread plan modification methods exist", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [sse(responseStarted(), assistantMessage("ok"), responseCompleted())],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread();

        // Verify plan modification methods exist
        expect(typeof thread.modifyPlan).toBe("function");
        expect(typeof thread.addTodo).toBe("function");
        expect(typeof thread.updateTodo).toBe("function");
        expect(typeof thread.removeTodo).toBe("function");
        expect(typeof thread.reorderTodos).toBe("function");
      } finally {
        await close();
      }
    });

    it("Thread.run surfaces scheduled plan updates in returned items", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread({ skipGitRepoCheck: true });

        await thread.run("first input");

        thread.updatePlan({
          plan: [
            { step: "Implement feature", status: "in_progress" },
            { step: "Write tests", status: "completed" },
          ],
        });

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toEqual([
          { text: "Implement feature", completed: false },
          { text: "Write tests", completed: true },
        ]);
      } finally {
        await close();
      }
    });

    it("Thread.addTodo adds a new todo item to the plan", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread({ skipGitRepoCheck: true });

        await thread.run("first input");

        // Set initial plan
        thread.updatePlan({
          plan: [{ step: "Existing task", status: "pending" }],
        });

        // Add a new todo
        thread.addTodo("New task", "in_progress");

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toHaveLength(2);
        expect(todoItem?.items[1]).toEqual({ text: "New task", completed: false });
      } finally {
        await close();
      }
    });

    it("Thread.updateTodo updates an existing todo item", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread({ skipGitRepoCheck: true });

        await thread.run("first input");

        // Set initial plan
        thread.updatePlan({
          plan: [
            { step: "Task 1", status: "pending" },
            { step: "Task 2", status: "pending" },
          ],
        });

        // Update the first task
        thread.updateTodo(0, { status: "completed" });
        // Update the second task's text and status
        thread.updateTodo(1, { step: "Updated Task 2", status: "in_progress" });

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toEqual([
          { text: "Task 1", completed: true },
          { text: "Updated Task 2", completed: false },
        ]);
      } finally {
        await close();
      }
    });

    it("Thread.removeTodo removes a todo item from the plan", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
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

        // Remove the middle task
        thread.removeTodo(1);

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toHaveLength(2);
        expect(todoItem?.items).toEqual([
          { text: "Task 1", completed: false },
          { text: "Task 3", completed: false },
        ]);
      } finally {
        await close();
      }
    });

    it("Thread.reorderTodos reorders todo items in the plan", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
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

        // Reorder: move last item to first position [2, 0, 1]
        thread.reorderTodos([2, 0, 1]);

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toEqual([
          { text: "Third", completed: false },
          { text: "First", completed: false },
          { text: "Second", completed: false },
        ]);
      } finally {
        await close();
      }
    });

    it("Thread.modifyPlan supports multiple operations in one call", async () => {
      const { url, close } = await startResponsesTestProxy({
        statusCode: 200,
        responseBodies: [
          sse(responseStarted("response_1"), assistantMessage("First", "item_1"), responseCompleted("response_1")),
          sse(responseStarted("response_2"), assistantMessage("Second", "item_2"), responseCompleted("response_2")),
        ],
      });

      try {
        const client = createClient(url);
        const thread = client.startThread({ skipGitRepoCheck: true });

        await thread.run("first input");

        // Set initial plan
        thread.updatePlan({
          plan: [
            { step: "Task 1", status: "pending" },
            { step: "Task 2", status: "pending" },
          ],
        });

        // Apply multiple operations at once
        thread.modifyPlan([
          { type: "update", index: 0, updates: { status: "completed" } },
          { type: "add", item: { step: "Task 3", status: "pending" } },
          { type: "remove", index: 1 },
        ]);

        const result = await thread.run("second input");
        const todoItem = result.items.find(
          (item: ThreadItem): item is Extract<ThreadItem, { type: "todo_list" }> => item.type === "todo_list",
        );

        expect(todoItem).toBeDefined();
        expect(todoItem?.items).toEqual([
          { text: "Task 1", completed: true },
          { text: "Task 3", completed: false },
        ]);
      } finally {
        await close();
      }
    });
  });
});
