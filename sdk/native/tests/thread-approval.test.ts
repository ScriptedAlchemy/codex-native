import { describe, expect, it } from "@jest/globals";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import type net from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { ApprovalBridge } from "../src/agents/approvalBridge";
import type { ApprovalDecision } from "../src/agents/approvalBridge";
import type { ApprovalRequest } from "../src/nativeBinding";

describe("ApprovalBridge", () => {
  const fakeSocket = () => {
    const writes: string[] = [];
    const socket = {
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as net.Socket;
    return { socket, writes };
  };

  const invokeBridge = async (
    handler: (request: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>,
    payload: ApprovalRequest
  ) => {
    const bridge = new ApprovalBridge(handler, process.cwd());
    const { socket, writes } = fakeSocket();
    await (bridge as any).handleApprovalRequest({ requestId: "req-1", payload }, socket);
    return { writes };
  };

  it("routes approval requests to the handler and returns responses", async () => {
    const requests: ApprovalRequest[] = [];
    const { writes } = await invokeBridge(async (request) => {
      requests.push(request);
      return { approved: true, reason: "Looks safe" };
    }, { type: "shell", details: { command: "ls" } });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.type).toBe("shell");
    const response = JSON.parse(writes[0]!);
    expect(response.approved).toBe(true);
    expect(response.reason).toContain("Looks safe");
  });

  it("can deny approvals via handler decisions", async () => {
    const { writes } = await invokeBridge(async () => false, { type: "file_write", details: { path: "/tmp/test" } });

    const response = JSON.parse(writes[0]!);
    expect(response.approved).toBe(false);
    expect(response.reason).toBe("Denied");
  });

  it("exposes NODE_PATH for spawned servers", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "approval-bridge-test-"));
    mkdirSync(path.join(workspace, "node_modules"));

    const bridge = new ApprovalBridge(async () => true, workspace);
    const { env } = await bridge.start();

    expect(env.APPROVAL_BRIDGE_SOCKET).toBeTruthy();
    expect(env.NODE_PATH).toBeDefined();
    expect(env.NODE_PATH!.split(path.delimiter).some((entry) => entry.includes("node_modules"))).toBe(true);

    await bridge.stop();
    rmSync(workspace, { recursive: true, force: true });
  });
});
