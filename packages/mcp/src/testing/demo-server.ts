import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// A local MCP server for demos (188), so Settings and the composer show a
// real `tools/list` without a third-party server: Streamable HTTP,
// stateless, three harmless tools that touch nothing outside the process.
// Started by `scripts/dev/mcp-demo-server.ts`; never by the app.

const WORD = /\S+/g;

const buildServer = (): McpServer => {
  const server = new McpServer({ name: "demo-tools", version: "1.0.0" });
  server.registerTool(
    "current_time",
    {
      description: "The current time, in ISO 8601 and the given time zone.",
      inputSchema: { timeZone: z.string().default("UTC") },
    },
    ({ timeZone }) => ({
      content: [
        {
          text: new Date().toLocaleString("en-GB", { timeZone }),
          type: "text",
        },
      ],
    })
  );
  server.registerTool(
    "roll_dice",
    {
      description: "Rolls some dice and returns each roll.",
      inputSchema: {
        count: z.int().min(1).max(20).default(1),
        sides: z.int().min(2).max(100).default(6),
      },
    },
    ({ count, sides }) => ({
      content: [
        {
          text: Array.from(
            { length: count },
            () => 1 + Math.floor(Math.random() * sides)
          ).join(", "),
          type: "text",
        },
      ],
    })
  );
  server.registerTool(
    "word_count",
    {
      description: "Counts the words and characters in some text.",
      inputSchema: { text: z.string().max(100_000) },
    },
    ({ text }) => ({
      content: [
        {
          text: `${text.match(WORD)?.length ?? 0} words, ${text.length} characters`,
          type: "text",
        },
      ],
    })
  );
  return server;
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
};

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== "POST") {
    // Stateless: no standalone SSE stream, no sessions to end.
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close().catch(() => undefined);
  });
  await buildServer().connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
};

export interface DemoServer {
  readonly close: () => Promise<void>;
  readonly url: string;
}

/** Listens on `127.0.0.1:port` (0 for any free port). */
export const startDemoServer = (port: number): Promise<DemoServer> =>
  new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address() as AddressInfo;
      resolve({
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
        url: `http://127.0.0.1:${bound}/mcp`,
      });
    });
  });
