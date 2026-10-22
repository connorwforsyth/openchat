// A local MCP server with three harmless tools (current_time, roll_dice,
// word_count) for demos and manual testing of connectors (188). Dev only:
// point an `mcp.servers` entry in a local app.config.yaml at the URL it
// prints. Operator entries are trusted, so the app reaches 127.0.0.1.
//
//   bun scripts/dev/mcp-demo-server.ts [port]   # default 8931

import { startDemoServer } from "../../packages/mcp/src/testing/demo-server";

const port = Number(process.argv[2] ?? 8931);
const server = await startDemoServer(port);
process.stdout.write(`MCP demo server on ${server.url}\n`);
