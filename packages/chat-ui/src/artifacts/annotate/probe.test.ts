import { afterEach, describe, expect, it } from "vitest";

import { RUNTIME_CHANNEL } from "../runtime-protocol";
import {
  asTarget,
  locateAt,
  NESTED_PROBE_CHANNEL,
  probeScript,
  readNestedAnswer,
  readProbeAnswer,
  readProbeRequest,
} from "./probe";

const frame = { name: "frame" };
const answer = (request: string, target: unknown = null) => ({
  channel: RUNTIME_CHANNEL,
  request,
  target,
  type: "annotate-probed",
});

describe("readProbeAnswer (in the host)", () => {
  it("takes the answer to its own request, from its frame", () => {
    const target = { selector: "h1", text: "Hi", type: "element" };
    expect(
      readProbeAnswer(
        { data: answer("r1", target), origin: "null", source: frame },
        frame,
        "r1"
      )
    ).toEqual({ ok: true, value: target });
  });

  it("drops answers it didn't ask for, from elsewhere, or out of shape", () => {
    const fine = { data: answer("r1"), origin: "null", source: frame };
    expect(readProbeAnswer(fine, frame, "r2").ok).toBe(false);
    expect(readProbeAnswer({ ...fine, source: {} }, frame, "r1").ok).toBe(
      false
    );
    expect(
      readProbeAnswer({ ...fine, origin: "https://evil.example" }, frame, "r1")
        .ok
    ).toBe(false);
    expect(
      readProbeAnswer(
        {
          ...fine,
          data: answer("r1", {
            selector: "p",
            text: "x".repeat(5000),
            type: "element",
          }),
        },
        frame,
        "r1"
      ).ok
    ).toBe(false);
  });
});

describe("readProbeRequest (in the frame)", () => {
  it("takes a probe only from the embedding window, on its origin", () => {
    const parent = { name: "parent" };
    const probe = {
      channel: RUNTIME_CHANNEL,
      height: 0,
      request: "r1",
      type: "annotate-probe",
      width: 0,
      x: 10,
      y: 20,
    };
    const expected = { origin: "https://chat.example", source: parent };
    expect(
      readProbeRequest(
        { data: probe, origin: "https://chat.example", source: parent },
        expected
      ).ok
    ).toBe(true);
    expect(
      readProbeRequest(
        { data: probe, origin: "https://chat.example", source: {} },
        expected
      ).ok
    ).toBe(false);
  });
});

describe("locateAt", () => {
  afterEach(() => document.body.replaceChildren());

  const centre = (element: Element) => {
    const box = element.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2] as const;
  };

  it("names a deck's slide, 1-based, and the element on it", () => {
    document.body.innerHTML = `
      <div class="deck">
        <div class="deck-slide" data-slide="a"><div class="deck-canvas"><h1>One</h1></div></div>
        <div class="deck-slide" data-slide="b"><div class="deck-canvas"><h1 class="title">Two</h1></div></div>
      </div>`;
    const [x, y] = centre(document.querySelectorAll("h1")[1] as Element);
    expect(asTarget(locateAt(x, y, 0, 0))).toEqual({
      selector: "h1.title",
      slide: 2,
      text: "Two",
      type: "slide",
    });
  });

  it("names a Mermaid node by its id and label", () => {
    document.body.innerHTML = `<svg width="200" height="100"><g class="node" id="flowchart-A-0"><rect width="200" height="100"></rect><text x="20" y="50">Start</text></g></svg>`;
    const [x, y] = centre(document.querySelector("rect") as Element);
    expect(asTarget(locateAt(x, y, 0, 0))).toEqual({
      id: "flowchart-A-0",
      label: "Start",
      type: "node",
    });
  });

  it("gives a box in an SVG as fractions of the drawing", () => {
    document.body.innerHTML = `<svg width="200" height="100" style="display:block"><rect width="200" height="100"></rect></svg>`;
    const box = (
      document.querySelector("svg") as Element
    ).getBoundingClientRect();
    const target = asTarget(locateAt(box.left + 50, box.top + 50, 100, 50));
    expect(target).toMatchObject({ height: 0.5, type: "box", width: 0.5 });
  });

  it("caps what it quotes from the page", () => {
    document.body.innerHTML = `<main><p id="long">${"word ".repeat(200)}</p></main>`;
    const [x, y] = centre(document.querySelector("p") as Element);
    const target = asTarget(locateAt(x, y, 0, 0));
    expect(target).toMatchObject({ selector: "p#long", type: "element" });
    expect(
      target?.type === "element" ? target.text?.length : undefined
    ).toBeLessThanOrEqual(280);
  });
});

describe("probeScript", () => {
  it("answers the runtime's question from inside a sandboxed page", async () => {
    const page = document.createElement("iframe");
    page.setAttribute("sandbox", "allow-scripts");
    page.style.cssText = "width:400px;height:200px;border:0";
    page.srcdoc = `<!doctype html><html><head>${probeScript()}</head><body style="margin:0"><h1 id="hello" style="margin:0;height:100px">Hello</h1></body></html>`;
    const loaded = new Promise((resolve) =>
      page.addEventListener("load", resolve, { once: true })
    );
    document.body.append(page);
    await loaded;
    const answered = new Promise<unknown>((resolve) => {
      window.addEventListener("message", function listen(event) {
        const target = readNestedAnswer(event, page.contentWindow, "q1");
        if (target !== undefined) {
          window.removeEventListener("message", listen);
          resolve(target);
        }
      });
    });
    page.contentWindow?.postMessage(
      {
        channel: NESTED_PROBE_CHANNEL,
        height: 0,
        request: "q1",
        type: "probe",
        width: 0,
        x: 50,
        y: 50,
      },
      "*"
    );
    expect(await answered).toEqual({
      selector: "h1#hello",
      text: "Hello",
      type: "element",
    });
    page.remove();
  });
});
