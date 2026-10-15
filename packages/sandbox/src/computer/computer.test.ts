import { fixtureId } from "@workspace/contract/fixtures";
import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import type { Sandbox } from "../ports/sandbox";
import { CONTROL_FLAG, EXIT_USER_CONTROL } from "./actions";
import {
  type ComputerOutput,
  createComputers,
  DESKTOP_VIEW_PORT,
  type DesktopHost,
  desktopIdFor,
} from "./computer";

const conversationId = fixtureId("conversation", 1);
const UUID_V8 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/** A desktop that records commands and answers with `exitCode`. */
const fakeHost = (exitCode = 0) => {
  const commands: string[] = [];
  const created: string[] = [];
  let userHas = false;
  const sandbox = {
    exec: (command: string) => {
      commands.push(command);
      if (command === `touch ${CONTROL_FLAG}`) {
        userHas = true;
      }
      return Promise.resolve(
        ok({
          durationMs: 1,
          exitCode,
          stderr: "",
          stdout: userHas ? "user\n" : "agent\n",
          truncated: false,
        })
      );
    },
    exposePort: (port: number) =>
      Promise.resolve(ok({ port, url: `http://x-${port}.sandbox.localhost` })),
    readFile: () => Promise.resolve(ok(JPEG)),
  } as unknown as Sandbox;
  const host: DesktopHost = {
    createDesktop: (spec) => {
      created.push(spec.id);
      return Promise.resolve(ok(sandbox));
    },
  };
  return { commands, created, host };
};

const execute = async (
  tools: ReturnType<ReturnType<typeof createComputers>["tools"]>,
  input: unknown
) =>
  (await tools.computer?.execute?.(input as never, {
    messages: [],
    toolCallId: "call_1",
  })) as ComputerOutput;

describe("desktopIdFor", () => {
  it("is stable per conversation and a UUID", () => {
    const id = desktopIdFor(conversationId);
    expect(id).toBe(desktopIdFor(conversationId));
    expect(id).not.toBe(desktopIdFor(fixtureId("conversation", 2)));
    expect(id).toMatch(UUID_V8);
  });
});

describe("the computer tool", () => {
  it("runs the action on the conversation's desktop and returns the screen", async () => {
    const { commands, created, host } = fakeHost();
    const tools = createComputers({ host }).tools(conversationId);
    const output = await execute(tools, { action: "click", x: 5, y: 6 });
    expect(created).toEqual([desktopIdFor(conversationId)]);
    expect(commands[0]).toContain("xdotool mousemove --sync 5 6 click 1");
    expect(output).toEqual({
      action: "click",
      ok: true,
      screenshot: { data: "/9j/2Q==", mediaType: "image/jpeg" },
    });
  });

  it("shows the model the screenshot as an image", async () => {
    const { host } = fakeHost();
    const tools = createComputers({ host }).tools(conversationId);
    const output = await execute(tools, { action: "screenshot" });
    const model = await tools.computer?.toModelOutput?.({
      input: { action: "screenshot" },
      output,
      toolCallId: "call_1",
    });
    expect(model).toMatchObject({
      type: "content",
      value: [
        { type: "text" },
        {
          data: { data: "/9j/2Q==", type: "data" },
          mediaType: "image/jpeg",
          type: "file",
        },
      ],
    });
  });

  it("answers bad input without touching the desktop", async () => {
    const { created, host } = fakeHost();
    const tools = createComputers({ host }).tools(conversationId);
    const output = await execute(tools, { action: "type" });
    expect(output.ok).toBe(false);
    expect(created).toEqual([]);
  });

  it("stands down while the person has control", async () => {
    const { host } = fakeHost(EXIT_USER_CONTROL);
    const tools = createComputers({ host }).tools(conversationId);
    const output = await execute(tools, { action: "key", keys: "Return" });
    expect(output).toMatchObject({ ok: false });
    expect(!output.ok && output.error).toContain("taken control");
  });
});

describe("the live view", () => {
  it("exposes noVNC and reports who drives", async () => {
    const { host } = fakeHost();
    const computers = createComputers({ host });
    expect(await computers.view(conversationId)).toEqual(
      ok({
        holder: "agent",
        url: `http://x-${DESKTOP_VIEW_PORT}.sandbox.localhost`,
      })
    );
    const taken = await computers.setControl(conversationId, "user");
    expect(taken).toMatchObject({ ok: true, value: { holder: "user" } });
  });
});
