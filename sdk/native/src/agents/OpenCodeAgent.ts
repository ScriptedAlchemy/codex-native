import type {
  Event as OpencodeEvent,
  OpencodeClient,
  Permission,
  Session,
  SessionPromptResponses,
} from "@opencode-ai/sdk";
import type { Usage } from "../events";
import net from "node:net";
import type { AddressInfo } from "node:net";

export type PermissionDecision = boolean | "once" | "always" | "reject" | { response: "once" | "always" | "reject" };

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5-20250929";
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 4096;

type OpencodeModule = typeof import("@opencode-ai/sdk");

let opencodeModulePromise: Promise<OpencodeModule> | null = null;

async function loadOpencodeModule(): Promise<OpencodeModule> {
  if (!opencodeModulePromise) {
    opencodeModulePromise = import("@opencode-ai/sdk");
  }
  return opencodeModulePromise;
}

async function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

async function findAvailablePort(host: string, preferred?: number): Promise<number> {
  if (preferred !== undefined && (await isPortAvailable(preferred, host))) {
    return preferred;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine available port")));
        return;
      }
      const { port } = address as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export interface PermissionRequest {
  id: string;
  type: string;
  title: string;
  sessionId: string;
  metadata: Record<string, unknown>;
  pattern?: string | string[];
}

export interface OpenCodeAgentOptions {
  /** Fully qualified base URL for an existing opencode server. When omitted the agent will start its own server. */
  baseUrl?: string;
  /** Hostname passed to `createOpencode` when auto-starting the server. */
  hostname?: string;
  /** Port passed to `createOpencode` when auto-starting the server. */
  port?: number;
  /** Additional configuration forwarded to `createOpencode`. */
  config?: Record<string, unknown>;
  /** Preferred model string in the form `provider/model`. */
  model?: string;
  /** Directory the OpenCode session should operate within. Defaults to the current working directory. */
  workingDirectory?: string;
  /** Optional user-friendly session title. */
  title?: string;
  /** Callback invoked whenever opencode asks for a permission decision. */
  onApprovalRequest?: (request: PermissionRequest) => PermissionDecision | Promise<PermissionDecision>;
  /** Override for tests – returns a hydrated opencode client. */
  clientFactory?: () => Promise<{ client: OpencodeClient; close?: () => void }>;
}

export interface DelegationResult {
  sessionId: string;
  /** Deprecated alias retained for backwards compatibility. */
  threadId?: string;
  output: string;
  success: boolean;
  error?: string;
  usage?: Usage | null;
}

type PromptResponse = SessionPromptResponses[keyof SessionPromptResponses];

export class OpenCodeAgent {
  private readonly options: OpenCodeAgentOptions;
  private readonly approvalHandler?: (request: PermissionRequest) => PermissionDecision | Promise<PermissionDecision>;
  private clientPromise?: Promise<OpencodeClient>;

  constructor(options: OpenCodeAgentOptions = {}) {
    this.options = options;
    this.approvalHandler = options.onApprovalRequest;
  }

  async delegate(task: string): Promise<DelegationResult> {
    return this.executeTask(task);
  }

  async delegateStreaming(task: string, onEvent?: (event: OpencodeEvent) => void, sessionId?: string): Promise<DelegationResult> {
    return this.executeTask(task, { sessionId, onEvent });
  }

  async resume(sessionId: string, task: string): Promise<DelegationResult> {
    return this.executeTask(task, { sessionId });
  }

  async workflow(steps: string[]): Promise<DelegationResult[]> {
    const results: DelegationResult[] = [];
    let sessionId: string | undefined;

    for (const step of steps) {
      const result = await this.executeTask(step, { sessionId });
      results.push(result);
      if (!result.success) {
        break;
      }
      sessionId = result.sessionId;
    }

    return results;
  }

  private async executeTask(prompt: string, options?: { sessionId?: string; onEvent?: (event: OpencodeEvent) => void }): Promise<DelegationResult> {
    let sessionId = options?.sessionId;
    try {
      const client = await this.ensureClient();
      sessionId = await this.ensureSession(client, sessionId, prompt);

      const shouldStream = Boolean(this.approvalHandler || options?.onEvent);
      const controller = new AbortController();
      const watcher = shouldStream
        ? this.watchEvents(client, sessionId, options?.onEvent, controller.signal).catch((error) => {
            if (!controller.signal.aborted) {
              throw error;
            }
          })
        : null;

      try {
        const promptBody: NonNullable<Parameters<OpencodeClient["session"]["prompt"]>[0]>["body"] = {
          parts: [{ type: "text", text: prompt }],
        };

        const parsedModel = this.parseModel(this.options.model ?? DEFAULT_MODEL);
        if (parsedModel) {
          promptBody.model = parsedModel;
        }

        const response = await client.session.prompt({
          path: { id: sessionId },
          body: promptBody,
          query: { directory: this.getWorkingDirectory() },
        });

        const data = this.extractData<PromptResponse>(response);
        return {
          sessionId,
          threadId: sessionId,
          output: this.collectText(data),
          success: true,
          usage: this.toUsage(data),
        };
      } finally {
        if (watcher) {
          controller.abort();
          await watcher;
        }
      }
    } catch (error) {
      return {
        sessionId: sessionId ?? "",
        threadId: sessionId,
        output: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async ensureClient(): Promise<OpencodeClient> {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    if (this.options.clientFactory) {
      this.clientPromise = this.options.clientFactory().then(({ client }) => client);
      return this.clientPromise;
    }

    if (this.options.baseUrl) {
      this.clientPromise = loadOpencodeModule().then(({ createOpencodeClient }) =>
        createOpencodeClient({
          baseUrl: this.options.baseUrl!,
        }),
      );
      return this.clientPromise;
    }

    this.clientPromise = loadOpencodeModule().then(async ({ createOpencode }) => {
      const hostname = this.options.hostname ?? DEFAULT_HOSTNAME;
      const port = await findAvailablePort(hostname, this.options.port ?? DEFAULT_PORT);
      const { client } = await createOpencode({ hostname, port, config: this.options.config });
      return client;
    });

    return this.clientPromise;
  }

  private async ensureSession(client: OpencodeClient, existingId: string | undefined, prompt: string): Promise<string> {
    if (existingId) {
      return existingId;
    }

    const result = await client.session.create({
      body: {
        title: this.options.title ?? this.createSessionTitle(prompt),
      },
      query: { directory: this.getWorkingDirectory() },
    });

    const session = this.extractData<Session>(result);
    return session.id;
  }

  private createSessionTitle(prompt: string): string {
    const [firstLineRaw = ""] = prompt.trim().split(/\r?\n/);
    const firstLine = firstLineRaw || "OpenCode Session";
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
  }

  private parseModel(model?: string): { providerID: string; modelID: string } | undefined {
    if (!model) {
      return undefined;
    }

    if (model.includes("/")) {
      const [providerPart, modelPart] = model.split("/", 2);
      const providerID = providerPart || "anthropic";
      const modelID = modelPart || providerPart || model;
      return { providerID, modelID };
    }

    return { providerID: "anthropic", modelID: model };
  }

  private collectText(response: PromptResponse): string {
    const texts = response.parts?.filter((part) => part.type === "text") ?? [];
    return texts.map((part) => part.text).join("\n").trim();
  }

  private toUsage(response: PromptResponse): Usage | null {
    const tokens = response.info?.tokens;
    if (!tokens) {
      return null;
    }

    return {
      input_tokens: tokens.input ?? 0,
      output_tokens: tokens.output ?? 0,
      cached_input_tokens: tokens.cache?.read ?? 0,
    };
  }

  private extractData<T>(result: unknown): T {
    if (result && typeof result === "object" && "data" in result) {
      const record = result as { data?: T; error?: unknown };
      if (record.data !== undefined) {
        return record.data;
      }

      throw new Error(this.describeError(record.error));
    }

    return result as T;
  }

  private describeError(error: unknown): string {
    if (!error) {
      return "Unknown OpenCode error";
    }

    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "object" && "message" in error && typeof (error as any).message === "string") {
      return (error as any).message;
    }

    return JSON.stringify(error);
  }

  private async watchEvents(
    client: OpencodeClient,
    sessionId: string,
    onEvent: ((event: OpencodeEvent) => void) | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const { stream } = await client.event.subscribe({
      signal,
      query: { directory: this.getWorkingDirectory() },
    });
    const handledPermissions = new Set<string>();

    for await (const event of stream) {
      if (signal.aborted) {
        break;
      }

      const targetSessionId = this.extractSessionId(event);
      if (this.approvalHandler && event.type === "permission.updated") {
        const permission = event.properties as Permission;
        if (permission.sessionID === sessionId && !handledPermissions.has(permission.id)) {
          handledPermissions.add(permission.id);
          await this.respondToPermission(client, permission);
        }
      }

      if (onEvent && targetSessionId === sessionId) {
        onEvent(event);
      }
    }
  }

  private extractSessionId(event: OpencodeEvent): string | undefined {
    const properties: Record<string, unknown> | undefined = (event as any).properties;
    if (!properties) {
      return undefined;
    }

    if (typeof properties.sessionID === "string") {
      return properties.sessionID;
    }

    if (typeof properties.info === "object" && properties.info !== null && "sessionID" in (properties.info as Record<string, unknown>)) {
      const value = (properties.info as Record<string, unknown>).sessionID;
      return typeof value === "string" ? value : undefined;
    }

    return undefined;
  }

  private async respondToPermission(client: OpencodeClient, permission: Permission): Promise<void> {
    if (!this.approvalHandler) {
      return;
    }

    const decision = await this.approvalHandler({
      id: permission.id,
      type: permission.type,
      title: permission.title,
      sessionId: permission.sessionID,
      metadata: (permission.metadata ?? {}) as Record<string, unknown>,
      pattern: Array.isArray(permission.pattern) ? permission.pattern.slice() : permission.pattern,
    });

    const response = this.normalizeDecision(decision);
    await client.postSessionIdPermissionsPermissionId({
      path: {
        id: permission.sessionID,
        permissionID: permission.id,
      },
      body: { response },
    });
  }

  private normalizeDecision(decision: PermissionDecision): "once" | "always" | "reject" {
    if (typeof decision === "boolean") {
      return decision ? "once" : "reject";
    }

    if (typeof decision === "string") {
      return decision;
    }

    return decision.response;
  }

  private getWorkingDirectory(): string {
    return this.options.workingDirectory ?? process.cwd();
  }
}
