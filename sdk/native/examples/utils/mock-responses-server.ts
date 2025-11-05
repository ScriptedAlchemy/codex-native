import http from "node:http";

type MockResponse = {
  id: string;
  message: string;
};

type MockServer = {
  url: string;
  close: () => Promise<void>;
};

function formatSseEvent(event: Record<string, unknown>): string {
  return `event: ${event.type}\n` + `data: ${JSON.stringify(event)}\n\n`;
}

function buildMockResponse(index: number, text: string): MockResponse {
  return {
    id: `mock_response_${index + 1}`,
    message: text,
  };
}

function createSseEvents(response: MockResponse) {
  const itemId = `${response.id}_item`;
  const outputTokens = Math.max(8, Math.ceil(response.message.length / 4));
  const totalTokens = 12 + outputTokens;
  return [
    {
      type: "response.created",
      response: {
        id: response.id,
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        role: "assistant",
        id: itemId,
        content: [
          {
            type: "output_text",
            text: response.message,
          },
        ],
      },
    },
    {
      type: "response.completed",
      response: {
        id: response.id,
        usage: {
          input_tokens: 12,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
          input_tokens_details: null,
          output_tokens_details: null,
        },
      },
    },
  ];
}

export async function startMockResponsesServer(messages: string[]): Promise<MockServer> {
  if (messages.length === 0) {
    throw new Error("startMockResponsesServer requires at least one message");
  }

  const responses = messages.map((message, index) => buildMockResponse(index, message));
  let responseIndex = 0;

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/responses") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;

    const events = createSseEvents(response);

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");

    for (const event of events) {
      res.write(formatSseEvent(event));
    }
    res.end();
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine mock server address"));
        return;
      }
      server.off("error", reject);
      resolve(`http://${address.address}:${address.port}`);
    });
    server.once("error", reject);
  });

  return {
    url,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
