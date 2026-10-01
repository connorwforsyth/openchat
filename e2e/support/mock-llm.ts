import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { z } from "zod";

// A tiny OpenAI-compatible model server for the end-to-end suite. The app
// talks to it through its ordinary `openai-compatible` provider (the same
// path as Ollama or vLLM), so nothing in the app knows it's under test and
// no real provider is ever called (AGENTS.md "Testing").
//
// Replies are deterministic and steered by the last user message:
//   - a title request (the title job's instructions) → `Topic <first words>`;
//   - after a tool result → `Tool result: <output>`;
//   - `[tool:<name> <json>]` → a call to that tool when it's offered
//     (`web_search`, an MCP tool such as `e2e__echo`, `create_artifact`, …);
//   - `[script:<name>]` → the steps of `SCRIPTS[name]`, one step per model
//     call (a step may call several tools), then `Script <name> done…`;
//   - `[plan:<base64url>]` → the same, with the steps in the message itself
//     (`planDirective` writes one), then `Plan done…`: for `packages/evals`,
//     whose cases play a model that does exactly what they say;
//   - `[show:system]` / `[show:history]` → the request's instructions, or its
//     messages one per line (`historyOf`), so a case can check what the
//     server put in front of the model;
//   - `[search:<query>]` → a `file_search` call when it's offered;
//   - `remember <fact>` → an `update_memory` call when it's offered;
//   - a planning run (plan mode, 106: its instructions say so) → `ls` with
//     bash when it's offered, then `PLAN_REPLY`; a run approving a plan (its
//     instructions hold `<approved-plan>`) → a `write` of the approved plan
//     to `plan.md`, which asks first, then `Built the plan.`;
//   - `[slow]` → forty numbered words, one every SLOW_TOKEN_MS;
//   - anything else → `Echo: <message>`, followed by `[<path>: <content>]`
//     for each workspace file the message mentions (`@file` and attachments,
//     which the server reads into the instructions; ticket 056).

const SLOW_TOKEN_MS = 120;

// `@workspace/ai`'s `prompts/fragments/plan.md`, as the server sends it.
const PLANNING = "This turn is for planning only.";
const APPROVED_PLAN = /<approved-plan>\n([\s\S]*?)\n<\/approved-plan>/;

/** What a planning run answers: a plan in the sections plan mode asks for. */
export const PLAN_REPLY = [
  "# Write a greeting",
  "",
  "## Goal",
  "The workspace has a greeting file.",
  "",
  "## Steps",
  "1. Write hello.txt with a greeting.",
  "",
  "## Files to touch",
  "- hello.txt (new)",
  "",
  "## Risks",
  "None.",
  "",
  "## Open questions",
  "None",
].join("\n");
const SLOW_TOKENS = 40;
const EMBEDDING_DIMENSIONS = 384;

const TOOL_DIRECTIVE = /\[tool:([a-z_][a-z0-9_]*)\s+(\{.*\})\]/is;
// Audit (t/audit-harness): `[script:<name>]` plays a scripted multi-step
// sequence from SCRIPTS: step N is picked by how many assistant tool-call
// turns follow the last user message, and a step may call several tools.
const SCRIPT_DIRECTIVE = /\[script:([a-z0-9_-]+)\]/i;
// `packages/evals`: a script carried in the message, as base64url JSON (no
// `]` in it, whatever the arguments hold), and a look at the request.
const PLAN_DIRECTIVE = /\[plan:([A-Za-z0-9_-]+)\]/;
const SHOW_DIRECTIVE = /\[show:(system|history)\]/i;
const SEARCH_DIRECTIVE = /\[search:([^\]]+)\]/i;
const REMEMBER = /\bremember (?:that )?(.+)$/i;
const TITLE_REQUEST = /short title for this conversation/i;
const DIRECTIVES = /\[[^\]]*\]/g;
const WHITESPACE = /\s+/;
const WHITESPACE_RUNS = /\s+/g;
const TOKENS = /\S+\s*/g;
const WORDS = /[a-z0-9]+/g;
const TRAILING_STOPS = /[.!]+$/;
const FIRST_PERSON = /^I /i;
// `server/runs/workspace-context.ts`: a mentioned file inlined whole.
const WORKSPACE_FILE =
  /<workspace-file path="([^"]*)">\n([\s\S]*?)\n<\/workspace-file>/g;

const textPartSchema = z.object({ text: z.string(), type: z.literal("text") });

const messageSchema = z.looseObject({
  content: z
    .union([z.string(), z.array(z.union([textPartSchema, z.looseObject({})]))])
    .nullish(),
  role: z.string(),
  tool_calls: z.array(z.unknown()).nullish(),
});

const chatRequestSchema = z.looseObject({
  messages: z.array(messageSchema),
  model: z.string(),
  stream: z.boolean().nullish(),
  tools: z
    .array(z.looseObject({ function: z.looseObject({ name: z.string() }) }))
    .nullish(),
});

const embeddingRequestSchema = z.looseObject({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string(),
});

type ChatRequest = z.infer<typeof chatRequestSchema>;
type Message = z.infer<typeof messageSchema>;

interface ToolReply {
  readonly args: string;
  /** Extra calls in the same step (scripts). */
  readonly more?: readonly { readonly args: string; readonly name: string }[];
  readonly name: string;
  readonly type: "tool";
}

const callSchema = z.object({
  args: z.record(z.string(), z.unknown()),
  name: z.string().min(1),
});
const planSchema = z.array(z.array(callSchema).min(1)).min(1);

export type Call = z.infer<typeof callSchema>;
/** The steps of a scripted turn: each is the tool calls of one model call. */
export type Plan = readonly (readonly Call[])[];

/** `[plan:…]` for a message: the mock plays `plan` as it plays a `SCRIPTS` entry. */
export const planDirective = (plan: Plan): string =>
  `[plan:${Buffer.from(JSON.stringify(plan)).toString("base64url")}]`;

const planOf = (userText: string): Plan | null => {
  const encoded = PLAN_DIRECTIVE.exec(userText)?.[1];
  if (!encoded) {
    return null;
  }
  try {
    const parsed = planSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const w = (path: string, content: string): Call => ({
  args: { content, path },
  name: "write",
});
const ed = (path: string, oldString: string, newString: string): Call => ({
  args: { newString, oldString, path },
  name: "edit",
});
const sh = (command: string): Call => ({ args: { command }, name: "bash" });
const rd = (path: string): Call => ({ args: { path }, name: "read" });
const HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 id="t">Site</h1><script src="script.js"></script></body></html>\n';
const CSS = "body { font-family: sans-serif; }\nh1 { color: teal; }\n";
const JS = "document.getElementById('t').textContent = 'Hello';\n";
export const SCRIPTS: Record<string, readonly (readonly Call[])[]> = {
  // (b) two edits to an existing file
  edit2: [
    [ed("notes.txt", "alpha", "ALPHA")],
    [ed("notes.txt", "omega", "OMEGA")],
  ],
  // one write, for the probes
  one: [[w("probe.txt", "probe\n")]],
  // (d) re-read then rewrite a file the user edited
  reread: [
    [rd("doc.txt")],
    [w("doc.txt", "rewritten by the agent\nkeeps: USER-EDIT\n")],
  ],
  // (d') a write proposed, (the user edits while it waits), then read + rewrite
  rewrite: [
    [w("doc.txt", "agent version\n")],
    [rd("doc.txt")],
    [w("doc.txt", "agent version after re-read\n")],
  ],
  // (c) scaffold: package.json, npm install, two sources, a test run
  scaffold: [
    [
      w(
        "proj/package.json",
        '{"name":"proj","version":"1.0.0","scripts":{"test":"node test.js"}}\n'
      ),
    ],
    [sh("cd proj && npm install")],
    [w("proj/index.js", "export const add = (a, b) => a + b;\n")],
    [
      w(
        "proj/test.js",
        "import { add } from './index.js';\nif (add(1, 2) !== 3) throw new Error('bad');\nconsole.log('ok');\n"
      ),
    ],
    [sh("cd proj && npm test")],
  ],
  // (a) three files, one per step, then a preview
  site: [
    [w("index.html", HTML)],
    [w("style.css", CSS)],
    [w("script.js", JS)],
    [{ args: { port: 8080 }, name: "preview" }],
  ],
  // (a') the same three files in one step (parallel tool calls)
  "site-batch": [
    [w("index.html", HTML), w("style.css", CSS), w("script.js", JS)],
    [{ args: { port: 8080 }, name: "preview" }],
  ],
  // a write, then a slow bash (cancel during a running tool)
  slow: [[w("slow.txt", "slow\n")], [sh("sleep 20; echo done")]],
};

const toolTurnsSinceUser = (request: ChatRequest): number => {
  const lastUser = request.messages.findLastIndex((m) => m.role === "user");
  return request.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0)
    .length;
};

/** Step N of `steps` (N tool turns since the user spoke), then a closing line. */
const stepsReply = (
  request: ChatRequest,
  steps: Plan,
  label: string
): Reply => {
  const index = toolTurnsSinceUser(request);
  const step = steps[index]?.filter((call) => offered(request, call.name));
  if (!step || step.length === 0) {
    const last = request.messages.at(-1);
    const output =
      last?.role === "tool"
        ? textOf(last).replace(WHITESPACE_RUNS, " ").slice(0, 300)
        : "";
    return text(`${label} done after ${index} steps. Last: ${output}`);
  }
  const [first, ...rest] = step;
  return {
    args: JSON.stringify(first?.args),
    more: rest.map((call) => ({
      args: JSON.stringify(call.args),
      name: call.name,
    })),
    name: first?.name ?? "",
    type: "tool",
  };
};

const scriptReply = (request: ChatRequest, userText: string): Reply | null => {
  const name = SCRIPT_DIRECTIVE.exec(userText)?.[1];
  const script = name ? SCRIPTS[name] : undefined;
  if (name && script) {
    return stepsReply(request, script, `Script ${name}`);
  }
  const plan = planOf(userText);
  return plan ? stepsReply(request, plan, "Plan") : null;
};

type Reply =
  | {
      readonly text: string;
      readonly tokenDelayMs: number;
      readonly type: "text";
    }
  | ToolReply;

const textOf = (message: Message | undefined): string => {
  const content = message?.content;
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .flatMap((part) => {
      const parsed = textPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join("\n");
};

const text = (value: string, tokenDelayMs = 0): Reply => ({
  text: value,
  tokenDelayMs,
  type: "text",
});

const titleFor = (prompt: string): string => {
  const firstUserLine =
    prompt
      .split("\n")
      .find((line) => line.startsWith("user:"))
      ?.slice("user:".length) ?? prompt;
  const words = firstUserLine
    .replace(DIRECTIVES, " ")
    .trim()
    .split(WHITESPACE)
    .filter(Boolean)
    .slice(0, 3);
  return `Topic ${words.join(" ")}`.trim();
};

const offered = (request: ChatRequest, name: string): boolean =>
  (request.tools ?? []).some((each) => each.function.name === name);

/** A tool call the message asks for, if the turn offers that tool. */
const toolCallFor = (
  request: ChatRequest,
  userText: string
): ToolReply | null => {
  const directive = TOOL_DIRECTIVE.exec(userText);
  if (directive?.[1] && directive[2] && offered(request, directive[1])) {
    return { args: directive[2], name: directive[1], type: "tool" };
  }
  const search = SEARCH_DIRECTIVE.exec(userText);
  if (search?.[1] && offered(request, "file_search")) {
    const args = JSON.stringify({ query: search[1].trim() });
    return { args, name: "file_search", type: "tool" };
  }
  const remember = REMEMBER.exec(userText.trim());
  if (remember?.[1] && offered(request, "update_memory")) {
    const fact = remember[1].replace(TRAILING_STOPS, "");
    const summary = fact.replace(FIRST_PERSON, "");
    const args = JSON.stringify({
      patches: [{ op: "append", text: `- ${fact}` }],
      summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    });
    return { args, name: "update_memory", type: "tool" };
  }
  return null;
};

const toolCallSchema = z.looseObject({
  function: z.looseObject({ arguments: z.string(), name: z.string() }),
});

/** Longest tool output `historyOf` repeats, so a big read stays one line. */
const HISTORY_OUTPUT_CHARS = 500;

/**
 * The request's messages after the instructions, one per line: `role: text`,
 * a tool call as `name(arguments)`. What the server sent as the conversation
 * so far, for `[show:history]`.
 */
export const historyOf = (request: ChatRequest): string =>
  request.messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const calls = (message.tool_calls ?? []).flatMap((call) => {
        const parsed = toolCallSchema.safeParse(call);
        return parsed.success
          ? [`${parsed.data.function.name}(${parsed.data.function.arguments})`]
          : [];
      });
      const said = textOf(message)
        .replace(WHITESPACE_RUNS, " ")
        .slice(0, HISTORY_OUTPUT_CHARS);
      return `${message.role}: ${[said, ...calls].filter(Boolean).join(" ")}`;
    })
    .join("\n");

/** Plan mode (106): a planning run, or a run carrying an approved plan. */
const planModeReply = (request: ChatRequest, system: string): Reply | null => {
  const steps = toolTurnsSinceUser(request);
  if (system.includes(PLANNING)) {
    return steps === 0 && offered(request, "bash")
      ? { args: JSON.stringify({ command: "ls" }), name: "bash", type: "tool" }
      : text(PLAN_REPLY);
  }
  const approved = APPROVED_PLAN.exec(system)?.[1];
  if (approved === undefined) {
    return null;
  }
  return steps === 0 && offered(request, "write")
    ? {
        args: JSON.stringify({ content: `${approved}\n`, path: "plan.md" }),
        name: "write",
        type: "tool",
      }
    : text("Built the plan.");
};

export const replyFor = (request: ChatRequest): Reply => {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map(textOf)
    .join("\n");
  const last = request.messages.at(-1);
  const userText = textOf(
    request.messages.findLast((message) => message.role === "user")
  );
  if (TITLE_REQUEST.test(system)) {
    return text(titleFor(userText));
  }
  const scripted =
    scriptReply(request, userText) ?? planModeReply(request, system);
  if (scripted) {
    return scripted;
  }
  if (last?.role === "tool") {
    const output = textOf(last).replace(WHITESPACE_RUNS, " ").slice(0, 2000);
    return text(`Tool result: ${output}`);
  }
  const show = SHOW_DIRECTIVE.exec(userText)?.[1]?.toLowerCase();
  if (show === "system") {
    return text(`System: ${system}`);
  }
  if (show === "history") {
    return text(`History:\n${historyOf(request)}`);
  }
  const call = toolCallFor(request, userText);
  if (call) {
    return call;
  }
  if (userText.includes("[slow]")) {
    const words = Array.from(
      { length: SLOW_TOKENS },
      (_, index) => `word${index + 1}`
    );
    return text(`Slow reply: ${words.join(" ")} done.`, SLOW_TOKEN_MS);
  }
  const files = [...system.matchAll(WORKSPACE_FILE)].map(
    ([, path, content]) => ` [${path}: ${content?.trim()}]`
  );
  return text(`Echo: ${userText.trim()}${files.join("")}`);
};

/** A stable unit vector per text: texts sharing words land near each other. */
export const embed = (input: string): number[] => {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of input.toLowerCase().match(WORDS) ?? []) {
    const slot =
      createHash("sha1").update(word).digest().readUInt32BE(0) %
      EMBEDDING_DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  // An empty text still needs a direction, or cosine distance is undefined.
  vector[0] = (vector[0] ?? 0) + 0.01;
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const USAGE = { completion_tokens: 8, prompt_tokens: 16, total_tokens: 24 };

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const embeddings = (response: ServerResponse, body: unknown) => {
  const parsed = embeddingRequestSchema.parse(body);
  const inputs =
    typeof parsed.input === "string" ? [parsed.input] : parsed.input;
  json(response, 200, {
    data: inputs.map((input, index) => ({
      embedding: embed(input),
      index,
      object: "embedding",
    })),
    model: parsed.model,
    object: "list",
    usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
  });
};

const toolCall = (
  reply: { readonly args: string; readonly name: string },
  id: string
) => ({
  function: { arguments: reply.args, name: reply.name },
  id: `call_${id}`,
  type: "function",
});

const toolCallsOf = (reply: ToolReply, id: string) => [
  toolCall(reply, id),
  ...(reply.more ?? []).map((call, index) =>
    toolCall(call, `${id}_${index + 1}`)
  ),
];

/** One answer as a single JSON body (`stream: false`, the title job). */
const complete = (
  response: ServerResponse,
  model: string,
  reply: Reply,
  id: string
) => {
  const message =
    reply.type === "text"
      ? { content: reply.text, role: "assistant" }
      : {
          content: null,
          role: "assistant",
          tool_calls: toolCallsOf(reply, id),
        };
  json(response, 200, {
    choices: [
      {
        finish_reason: reply.type === "text" ? "stop" : "tool_calls",
        index: 0,
        message,
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl-${id}`,
    model,
    object: "chat.completion",
    usage: USAGE,
  });
};

/** One answer as server-sent chunks, paced for `[slow]`. */
const stream = async (
  response: ServerResponse,
  model: string,
  reply: Reply,
  id: string
) => {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  const chunk = (extra: Record<string, unknown>) =>
    response.write(
      `data: ${JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        id: `chatcmpl-${id}`,
        model,
        object: "chat.completion.chunk",
        ...extra,
      })}\n\n`
    );
  const send = (delta: Record<string, unknown>, finish: string | null = null) =>
    chunk({ choices: [{ delta, finish_reason: finish, index: 0 }] });
  send({ content: "", role: "assistant" });
  if (reply.type === "text") {
    for (const token of reply.text.match(TOKENS) ?? [reply.text]) {
      if (response.destroyed) {
        return;
      }
      send({ content: token });
      // biome-ignore lint/performance/noAwaitInLoops: tokens are paced on purpose.
      await sleep(reply.tokenDelayMs);
    }
    send({}, "stop");
  } else {
    send({
      tool_calls: toolCallsOf(reply, id).map((call, index) => ({
        ...call,
        index,
      })),
    });
    send({}, "tool_calls");
  }
  chunk({ choices: [], usage: USAGE });
  response.end("data: [DONE]\n\n");
};

export interface MockLlm {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

export const startMockLlm = async (port = 0): Promise<MockLlm> => {
  let sequence = 0;
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const { pathname } = new URL(request.url ?? "/", "http://mock");
    if (request.method === "GET" && pathname.endsWith("/models")) {
      // The catalog a discovering provider reads (095), with the metadata
      // the picker's preview card shows (099), in the Vercel AI Gateway's
      // shape. `parrot` is only offered through discovery; `parrot-fast` is
      // its fast mode, which the picker folds into it (105), Echo reasons,
      // so it has thinking levels, and GPT-5.2's maker has a fast tier.
      json(response, 200, {
        data: [
          {
            context_window: 128_000,
            id: "echo",
            name: "Echo",
            object: "model",
            pricing: { input: "0.000001", output: "0.000004" },
            tags: ["tool-use", "reasoning"],
          },
          {
            context_window: 32_000,
            id: "parrot",
            name: "Parrot",
            object: "model",
          },
          {
            context_window: 32_000,
            id: "parrot-fast",
            name: "Parrot Fast",
            object: "model",
          },
          // Through a gateway, a model whose maker has a fast tier (105).
          {
            context_window: 400_000,
            id: "openai/gpt-5.2",
            name: "GPT-5.2",
            object: "model",
            tags: ["reasoning"],
          },
        ],
      });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    const body = await readBody(request);
    if (pathname.endsWith("/embeddings")) {
      embeddings(response, body);
      return;
    }
    if (!pathname.endsWith("/chat/completions")) {
      response.writeHead(404).end();
      return;
    }
    const chat = chatRequestSchema.parse(body);
    sequence += 1;
    const reply = replyFor(chat);
    const answer = chat.stream ? stream : complete;
    await answer(response, chat.model, reply, `e2e-${sequence}`);
  };
  const server: Server = createServer((request, response) => {
    handle(request, response).catch((cause: unknown) => {
      if (!response.headersSent) {
        json(response, 400, {
          error: { message: cause instanceof Error ? cause.message : "bad" },
        });
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${bound}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
