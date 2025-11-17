import net from "node:net";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import type { ApprovalRequest } from "../nativeBinding";

const PERMISSION_TOOL_NAME = "mcp__codex-approval-server__approve";

const APPROVAL_SERVER_TEMPLATE = String.raw`
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const socketPath = process.env.APPROVAL_BRIDGE_SOCKET;
if (!socketPath) {
  console.error('Missing APPROVAL_BRIDGE_SOCKET');
  process.exit(1);
}

const bridge = net.createConnection(socketPath);
let buffer = '';
const pending = new Map();

bridge.setEncoding('utf8');
bridge.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      if (message.type === 'approval_response' && message.requestId) {
        const entry = pending.get(message.requestId);
        if (entry) {
          pending.delete(message.requestId);
          entry.resolve(message);
        }
      }
    } catch (error) {
      console.error('Failed to parse approval response:', error);
    }
  }
});

bridge.on('error', (error) => {
  console.error('Approval bridge error:', error);
});

const waitForResponse = (requestId) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Approval bridge timed out waiting for response'));
    }, 120000);

    pending.set(requestId, {
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      },
      reject,
    });
  });

const sendRequest = async (payload) => {
  const requestId = randomUUID();
  bridge.write(
    JSON.stringify({
      type: 'approval_request',
      requestId,
      payload,
    }) + '\n'
  );
  return waitForResponse(requestId);
};

const server = new Server(
  {
    name: 'codex-approval-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {
        'codex-approval-server': {},
      },
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'approve',
        description:
          'Request approval for an action before executing tools or commands.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of action (shell, file_write, network_access, etc.)',
            },
            details: {
              type: 'object',
              description: 'Additional details about the requested action',
            },
          },
          required: ['type'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'approve') {
    throw new Error('Unknown tool: ' + request.params.name);
  }

  const payload = request.params.arguments || {};
  const response = await sendRequest(payload);
  const approved = Boolean(response?.approved);
  const reason = response?.reason || (approved ? 'Approved' : 'Denied');

  return {
    content: [
      {
        type: 'text',
        text: approved ? '✅ APPROVED: ' + reason : '❌ DENIED: ' + reason,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;

function createIpcPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\codex-approval-${process.pid}-${Date.now()}`;
  }

  return join(tmpdir(), `codex-approval-${process.pid}-${Date.now()}.sock`);
}

export type ApprovalDecision =
  | boolean
  | {
      approved: boolean;
      reason?: string;
    };

export class ApprovalBridge {
  private server?: net.Server;
  private socketPath?: string;
  private scriptPath?: string;
  private mcpConfigPath?: string;

  constructor(
    private readonly handler: (request: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>,
    private readonly workingDirectory: string
  ) {}

  public get permissionToolName(): string {
    return PERMISSION_TOOL_NAME;
  }

  async start(): Promise<{ mcpConfigPath: string; env: Record<string, string> }> {
    this.socketPath = createIpcPath();
    await this.startServer();

    this.scriptPath = join(tmpdir(), `codex-approval-server-${process.pid}-${Date.now()}.mjs`);
    writeFileSync(this.scriptPath, APPROVAL_SERVER_TEMPLATE, "utf8");

    this.mcpConfigPath = join(tmpdir(), `codex-approval-config-${process.pid}-${Date.now()}.json`);
    const config = {
      mcpServers: {
        "codex-approval-server": {
          command: process.execPath,
          args: [this.scriptPath],
        },
      },
    };
    writeFileSync(this.mcpConfigPath, JSON.stringify(config, null, 2), "utf8");

    const env: Record<string, string> = {
      APPROVAL_BRIDGE_SOCKET: this.socketPath,
    };

    const nodePathEntries: string[] = [];
    if (process.env.NODE_PATH && process.env.NODE_PATH.length > 0) {
      nodePathEntries.push(process.env.NODE_PATH);
    }

    const workspaceNodeModules = join(this.workingDirectory, "node_modules");
    if (existsSync(workspaceNodeModules)) {
      nodePathEntries.push(workspaceNodeModules);
    }

    if (nodePathEntries.length > 0) {
      env.NODE_PATH = nodePathEntries.join(delimiter);
    }

    return {
      mcpConfigPath: this.mcpConfigPath,
      env,
    };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });

    if (this.socketPath && process.platform !== "win32") {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // ignore cleanup errors
      }
    }

    if (this.scriptPath) {
      try {
        unlinkSync(this.scriptPath);
      } catch {
        // ignore cleanup errors
      }
    }

    if (this.mcpConfigPath) {
      try {
        unlinkSync(this.mcpConfigPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async startServer(): Promise<void> {
    if (!this.socketPath) {
      throw new Error("Socket path not initialized");
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) {
          continue;
        }

        try {
          const message = JSON.parse(line);
          if (message.type === "approval_request") {
            this.handleApprovalRequest(message, socket).catch((error) => {
              const response = {
                type: "approval_response",
                requestId: message.requestId,
                approved: false,
                reason: error instanceof Error ? error.message : String(error),
              };
              socket.write(JSON.stringify(response) + "\n");
            });
          }
        } catch (error) {
          const response = {
            type: "approval_response",
            requestId: randomUUID(),
            approved: false,
            reason: error instanceof Error ? error.message : String(error),
          };
          socket.write(JSON.stringify(response) + "\n");
        }
      }
    });
  }

  private async handleApprovalRequest(message: any, socket: net.Socket): Promise<void> {
    const requestId: string = message.requestId || randomUUID();
    const payload: ApprovalRequest = {
      type: message.payload?.type ?? "shell",
      details: message.payload?.details ?? {},
      context: message.payload?.context,
    };

    const decision = await this.coerceDecision(await this.handler(payload));

    const response = {
      type: "approval_response",
      requestId,
      approved: decision.approved,
      reason: decision.reason,
    };

    socket.write(JSON.stringify(response) + "\n");
  }

  private async coerceDecision(input: ApprovalDecision): Promise<{ approved: boolean; reason: string }> {
    if (typeof input === "boolean") {
      return {
        approved: input,
        reason: input ? "Approved" : "Denied",
      };
    }

    return {
      approved: input.approved,
      reason: input.reason ?? (input.approved ? "Approved" : "Denied"),
    };
  }
}
