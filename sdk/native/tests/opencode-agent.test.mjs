import { describe, expect, it, jest } from "@jest/globals";

if (process.env.CI) {
  describe.skip("OpenCodeAgent", () => {
    it("skipped in CI due to missing OpenCode auth", () => {
      expect(true).toBe(true);
    });
  });
} else {
  await (async () => {
    const { OpenCodeAgent } = await import("../dist/index.mjs");

    const baseSession = {
      id: "session-1",
      projectID: "project-1",
      directory: process.cwd(),
      title: "Test session",
      version: "1",
      time: { created: Date.now(), updated: Date.now() },
    };

    const basePromptResponse = {
      info: {
        id: "message-1",
        sessionID: "session-1",
        role: "assistant",
        time: { created: Date.now() },
        parentID: "parent",
        modelID: "claude",
        providerID: "anthropic",
        mode: "text",
        path: { cwd: process.cwd(), root: process.cwd() },
        cost: 0,
        tokens: {
          input: 10,
          output: 5,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
      parts: [
        {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "Task completed",
        },
      ],
    };

    describe("OpenCodeAgent", () => {
      it("creates a session and sends a prompt", async () => {
        const client = createMockClient({ promptResponse: basePromptResponse });
        const agent = new OpenCodeAgent({
          clientFactory: async () => ({ client }),
        });

        const result = await agent.delegate("List files");

        expect(client.session.create).toHaveBeenCalledTimes(1);
        expect(client.session.prompt).toHaveBeenCalledWith(
          expect.objectContaining({ path: { id: "session-1" } }),
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe("Task completed");
      });

      it("reuses existing sessions when resuming", async () => {
        const client = createMockClient({ promptResponse: basePromptResponse });
        const agent = new OpenCodeAgent({ clientFactory: async () => ({ client }) });

        const result = await agent.resume("session-existing", "Continue");

        expect(client.session.create).not.toHaveBeenCalled();
        expect(client.session.prompt).toHaveBeenCalledWith(
          expect.objectContaining({ path: { id: "session-existing" } }),
        );
        expect(result.sessionId).toBe("session-existing");
      });

      it("handles approval requests via callback", async () => {
        const permissionEvent = {
          type: "permission.updated",
          properties: {
            id: "perm-1",
            type: "shell",
            sessionID: "session-1",
            messageID: "message-1",
            title: "Run command",
            metadata: { command: "ls" },
            time: { created: Date.now() },
          },
        };

        const client = createMockClient({ promptResponse: basePromptResponse, events: [permissionEvent] });
        const approvalHandler = jest.fn().mockResolvedValue(true);
        const agent = new OpenCodeAgent({
          onApprovalRequest: approvalHandler,
          clientFactory: async () => ({ client }),
        });

        await agent.delegateStreaming("Do work");

        expect(approvalHandler).toHaveBeenCalledWith(
          expect.objectContaining({ id: "perm-1", type: "shell", title: "Run command" }),
        );
        expect(client.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith(
          expect.objectContaining({
            path: { id: "session-1", permissionID: "perm-1" },
            body: { response: "once" },
          }),
        );
      });
    });

    function createMockClient(params) {
      const sessionCreate = jest.fn().mockResolvedValue({ data: baseSession, error: undefined });
      const sessionPrompt = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return { data: params.promptResponse, error: undefined };
      });
      const subscribeMock = jest.fn().mockImplementation(async (options = {}) => {
        const events = params.events ?? [];
        let aborted = false;
        options.signal?.addEventListener("abort", () => {
          aborted = true;
        });

        async function* generator() {
          for (const event of events) {
            if (aborted) return;
            yield event;
          }
          while (!aborted) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        return { stream: generator() };
      });

      return {
        session: {
          create: sessionCreate,
          prompt: sessionPrompt,
        },
        event: {
          subscribe: subscribeMock,
        },
        postSessionIdPermissionsPermissionId: jest.fn().mockResolvedValue({ data: true, error: undefined }),
      };
    }
  })();
}
