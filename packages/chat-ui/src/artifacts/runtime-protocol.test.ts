import { describe, expect, it } from "vitest";

import {
  isRuntimeKind,
  MAX_FRAME_HEIGHT,
  parentOriginFrom,
  parseOrigin,
  type RenderRequest,
  RUNTIME_CHANNEL,
  readFrameMessage,
  readHostMessage,
  runtimeOriginFrom,
  runtimeUrl,
} from "./runtime-protocol";

const APP = "https://chat.example";
const parentWindow = { name: "parent" };
const frameWindow = { name: "frame" };

const render: RenderRequest = {
  channel: RUNTIME_CHANNEL,
  code: "export default () => <p>hi</p>;",
  fileName: "Hi.tsx",
  id: "1",
  kind: "react",
  theme: "dark",
  title: "Hi",
  type: "render",
};

describe("readHostMessage (in the frame)", () => {
  const expected = { origin: APP, source: parentWindow };

  it("accepts a render request from the embedding window on its origin", () => {
    expect(
      readHostMessage(
        { data: render, origin: APP, source: parentWindow },
        expected
      )
    ).toEqual({ ok: true, value: render });
  });

  it("rejects other windows, other origins, other channels and bad shapes", () => {
    const read = (event: Parameters<typeof readHostMessage>[0]) =>
      readHostMessage(event, expected);
    expect(read({ data: render, origin: APP, source: frameWindow })).toEqual({
      error: "source",
      ok: false,
    });
    expect(
      read({
        data: render,
        origin: "https://evil.example",
        source: parentWindow,
      })
    ).toEqual({ error: "origin", ok: false });
    expect(
      read({
        data: { ...render, channel: "devtools" },
        origin: APP,
        source: parentWindow,
      })
    ).toEqual({ error: "channel", ok: false });
    expect(
      read({
        data: { ...render, kind: "code" },
        origin: APP,
        source: parentWindow,
      })
    ).toEqual({ error: "shape", ok: false });
    expect(read({ data: "hello", origin: APP, source: parentWindow })).toEqual({
      error: "channel",
      ok: false,
    });
  });
});

describe("readFrameMessage (in the panel)", () => {
  const ready = { channel: RUNTIME_CHANNEL, type: "ready" };

  it("accepts messages from our frame, whose sandbox makes its origin opaque", () => {
    expect(
      readFrameMessage(
        { data: ready, origin: "null", source: frameWindow },
        frameWindow
      )
    ).toEqual({ ok: true, value: ready });
  });

  it("has no message for the frame to edit the deck or undo", () => {
    // The deck's own code runs in the frame and can post what the runtime
    // can; edits are made on this side only.
    for (const data of [
      {
        channel: RUNTIME_CHANNEL,
        id: "1",
        previous: "Q3",
        target: { column: 4, line: 5, slide: "intro" },
        text: "Owned",
        type: "text-edited",
      },
      { channel: RUNTIME_CHANNEL, command: "undo", id: "1", type: "command" },
    ]) {
      expect(
        readFrameMessage(
          { data, origin: "null", source: frameWindow },
          frameWindow
        )
      ).toEqual({ error: "shape", ok: false });
    }
  });

  it("rejects another window, a real origin, or no frame yet", () => {
    expect(
      readFrameMessage(
        { data: ready, origin: "null", source: parentWindow },
        frameWindow
      )
    ).toEqual({ error: "source", ok: false });
    // A frame that somehow isn't sandboxed any more is not ours to trust.
    expect(
      readFrameMessage(
        {
          data: ready,
          origin: "http://artifacts.localhost:3910",
          source: frameWindow,
        },
        frameWindow
      )
    ).toEqual({ error: "origin", ok: false });
    expect(
      readFrameMessage({ data: ready, origin: "null", source: null }, null)
    ).toEqual({ error: "source", ok: false });
  });

  it("parses errors and clamps nothing silently: oversize heights are rejected", () => {
    const error = {
      channel: RUNTIME_CHANNEL,
      error: { kind: "import", message: "zod" },
      id: "3",
      type: "error",
    };
    expect(
      readFrameMessage(
        { data: error, origin: "null", source: frameWindow },
        frameWindow
      )
    ).toEqual({ ok: true, value: error });
    expect(
      readFrameMessage(
        {
          data: {
            channel: RUNTIME_CHANNEL,
            height: MAX_FRAME_HEIGHT + 1,
            type: "resize",
          },
          origin: "null",
          source: frameWindow,
        },
        frameWindow
      )
    ).toEqual({ error: "shape", ok: false });
  });
});

describe("origins", () => {
  it("reads the runtime origin from config, or none", () => {
    expect(runtimeOriginFrom(undefined)).toBeNull();
    expect(runtimeOriginFrom("  ")).toBeNull();
    expect(runtimeOriginFrom("not a url")).toBeNull();
    expect(runtimeOriginFrom("javascript:alert(1)")).toBeNull();
    expect(runtimeOriginFrom("http://artifacts.localhost:3910/")).toBe(
      "http://artifacts.localhost:3910"
    );
  });

  it("round-trips the parent origin through the runtime URL", () => {
    const url = new URL(runtimeUrl("https://artifacts.example", APP));
    expect(url.origin).toBe("https://artifacts.example");
    expect(parentOriginFrom(url.search)).toEqual({ ok: true, value: APP });
  });

  it("only trusts a bare http(s) origin as the parent", () => {
    expect(parentOriginFrom("")).toEqual({ error: "missing", ok: false });
    expect(parentOriginFrom("?parent=https://chat.example/x")).toEqual({
      error: "invalid",
      ok: false,
    });
    expect(parentOriginFrom("?parent=null")).toEqual({
      error: "invalid",
      ok: false,
    });
    expect(parseOrigin("data:text/html,hi")).toEqual({
      error: "invalid",
      ok: false,
    });
  });

  it("knows which kinds the runtime renders", () => {
    expect(["html", "svg", "react", "mermaid"].every(isRuntimeKind)).toBe(true);
    expect(isRuntimeKind("markdown")).toBe(false);
    expect(isRuntimeKind("code")).toBe(false);
  });
});
