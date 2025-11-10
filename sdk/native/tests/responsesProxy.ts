import http from "node:http";
import { evCompleted, evAssistantMessage } from "../src/index";

const DEFAULT_RESPONSE_ID = "resp_mock";
const DEFAULT_MESSAGE_ID = "msg_mock";

interface Usage {
  input_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details?: null;
  total_tokens: number;
}

const DEFAULT_COMPLETED_USAGE: Usage = {
  input_tokens: 42,
  input_tokens_details: { cached_tokens: 12 },
  output_tokens: 5,
  output_tokens_details: null,
  total_tokens: 47,
};

interface SseEvent {
  type: string;
  [key: string]: any;
}

function formatSseEvent(event: SseEvent): string {
  return `event: ${event.type}\n` + `data: ${JSON.stringify(event)}\n\n`;
}

interface TestProxyOptions {
  responseBodies: Array<{ events: SseEvent[] }>;
  statusCode?: number;
}

interface TestProxyResult {
  url: string;
  close: () => Promise<void>;
  requests: Array<{
    body: string;
    json: any;
    headers: Record<string, string>;
  }>;
}

export async function startResponsesTestProxy(options: TestProxyOptions): Promise<TestProxyResult> {
  const responseBodies = options.responseBodies;
  if (responseBodies.length === 0) {
    throw new Error("responseBodies is required");
  }

  const requests: Array<{
    body: string;
    json: any;
    headers: Record<string, string>;
  }> = [];

  function readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }

  let responseIndex = 0;

  const server = http.createServer((req, res) => {
    async function handle() {
      if (req.method === "POST" && req.url === "/responses") {
        const body = await readRequestBody(req);
        const json = JSON.parse(body);
        requests.push({ body, json, headers: { ...req.headers } as Record<string, string> });

        const status = options.statusCode ?? 200;
        res.statusCode = status;
        res.setHeader("content-type", "text/event-stream");

        const responseBody = responseBodies[Math.min(responseIndex, responseBodies.length - 1)];
        responseIndex += 1;
        if (responseBody) {
          for (const event of responseBody.events) {
            res.write(formatSseEvent(event));
          }
        }
        res.end();
        return;
      }

      res.statusCode = 404;
      res.end();
    }

    handle().catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine proxy address"));
        return;
      }
      server.off("error", reject);
      resolve(`http://${address.address}:${address.port}`);
    });
    server.once("error", reject);
  });

  async function close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  return { url, close, requests };
}

interface SseResponse {
  kind: "sse";
  events: SseEvent[];
}

export function sse(...events: SseEvent[]): SseResponse {
  return {
    kind: "sse",
    events,
  };
}

export function responseStarted(responseId: string = DEFAULT_RESPONSE_ID): SseEvent {
  return {
    type: "response.created",
    response: {
      id: responseId,
    },
  };
}

export function assistantMessage(text: string, itemId: string = DEFAULT_MESSAGE_ID): SseEvent {
  // Use the real SSE generator from Rust
  const eventJson = evAssistantMessage(itemId, text);
  return JSON.parse(eventJson);
}

export function responseFailed(errorMessage: string): SseEvent {
  return {
    type: "error",
    error: { code: "rate_limit_exceeded", message: errorMessage },
  };
}

export function responseCompleted(
  responseId: string = DEFAULT_RESPONSE_ID,
  usage: Usage = DEFAULT_COMPLETED_USAGE,
  finalText?: string
): SseEvent {
  // Use the real SSE generator from Rust
  const eventJson = evCompleted(responseId);
  const response: SseEvent = JSON.parse(eventJson);

  // Update usage if provided (for compatibility with existing tests)
  if (usage.input_tokens !== 0 || usage.output_tokens !== 0) {
    response.response.usage = {
      input_tokens: usage.input_tokens,
      input_tokens_details: usage.input_tokens_details || null,
      output_tokens: usage.output_tokens,
      output_tokens_details: usage.output_tokens_details || null,
      total_tokens: usage.total_tokens,
    };
  }

  if (typeof finalText === "string") {
    (response.response as any).output = [
      {
        id: DEFAULT_MESSAGE_ID,
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: finalText,
          },
        ],
      },
    ];
    (response.response as any).output_text = finalText;
  }
  return response;
}