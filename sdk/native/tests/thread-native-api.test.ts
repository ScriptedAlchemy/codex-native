import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { PlanOperation } from "../src/nativeBinding";

const emitBackgroundEventMock = jest.fn<(request: unknown) => Promise<void>>().mockResolvedValue(undefined);
const emitPlanUpdateMock = jest.fn();
const modifyPlanMock = jest.fn();

jest.unstable_mockModule("../src/nativeBinding", () => ({
  getNativeBinding: () => ({
    emitBackgroundEvent: emitBackgroundEventMock,
    emitPlanUpdate: emitPlanUpdateMock,
    modifyPlan: modifyPlanMock,
  }),
}));

const { Thread } = await import("../src/thread");

describe("Thread native API integration", () => {
  beforeEach(() => {
    emitBackgroundEventMock.mockReset();
    emitPlanUpdateMock.mockReset();
    modifyPlanMock.mockReset();
  });

  it("sendBackgroundEvent forwards to native binding", async () => {
    const thread = new Thread({} as any, {}, {}, "thread-123");

    await thread.sendBackgroundEvent("Status update");

    expect(emitBackgroundEventMock).toHaveBeenCalledWith({
      threadId: "thread-123",
      message: "Status update",
    });
  });

  it("sendBackgroundEvent rejects empty messages", async () => {
    const thread = new Thread({} as any, {}, {}, "thread-123");

    await expect(thread.sendBackgroundEvent("   ")).rejects.toThrow(
      "Background event message must be a non-empty string",
    );
  });

  it("updatePlan and modifyPlan forward operations to native binding", () => {
    const thread = new Thread({} as any, {}, {}, "thread-123");

    thread.updatePlan({
      explanation: "Plan refresh",
      plan: [
        { step: "Gather context", status: "completed" },
        { step: "Implement changes", status: "in_progress" },
      ],
    });

    expect(emitPlanUpdateMock).toHaveBeenCalledWith({
      threadId: "thread-123",
      explanation: "Plan refresh",
      plan: [
        { step: "Gather context", status: "completed" },
        { step: "Implement changes", status: "in_progress" },
      ],
    });

    const operations: PlanOperation[] = [
      { type: "update", index: 0, updates: { status: "completed" } },
      { type: "add", item: { step: "Verify outcome", status: "pending" } },
      { type: "remove", index: 1 },
    ];

    thread.modifyPlan(operations);

    expect(modifyPlanMock).toHaveBeenCalledWith({
      threadId: "thread-123",
      operations,
    });
  });
});
