import {
  type FrameMessage,
  MAX_FRAME_HEIGHT,
  parentOriginFrom,
  type RenderRequest,
  RUNTIME_CHANNEL,
  type RuntimeError,
  readHostMessage,
} from "@workspace/chat-ui/artifacts/runtime-protocol";

import type { Teardown } from "./documents";
import { runtimeError } from "./errors";
import { rendererFor } from "./renderers";

// The artifact runtime (D24): the page the artifacts panel loads in a
// sandboxed iframe on this separate origin. It says `ready`, then renders
// whatever artifact the embedding page posts, reporting `rendered`, `error`
// and its content height back. Each kind is drawn by the renderer its
// definition names (`./renderers`, 123).

const root = document.getElementById("root");
const parent = parentOriginFrom(window.location.search);

const start = (container: HTMLElement, parentOrigin: string) => {
  const post = (message: FrameMessage) =>
    window.parent.postMessage(message, parentOrigin);

  // The render on screen; replies for anything older are dropped.
  let current: RenderRequest | null = null;
  let teardown: Teardown | null = null;

  const isCurrent = (request: RenderRequest) => current === request;
  const fail = (request: RenderRequest, error: RuntimeError) => {
    if (isCurrent(request)) {
      post({ channel: RUNTIME_CHANNEL, error, id: request.id, type: "error" });
    }
  };
  const done = (request: RenderRequest) => {
    if (isCurrent(request)) {
      post({ channel: RUNTIME_CHANNEL, id: request.id, type: "rendered" });
    }
  };

  const render = async (request: RenderRequest) => {
    current = request;
    teardown?.();
    teardown = null;
    container.replaceChildren();
    document.documentElement.style.colorScheme = request.theme;
    document.title = request.title;

    const renderer = rendererFor(request.kind);
    if (!renderer) {
      return;
    }
    const undo = await renderer(container, request, {
      done: () => done(request),
      fail: (error) => fail(request, error),
      isCurrent: () => isCurrent(request),
    });
    if (isCurrent(request)) {
      teardown = undo;
    } else {
      // Superseded while it rendered: the newer render cleared the page.
      undo?.();
    }
  };

  window.addEventListener("message", (event) => {
    const message = readHostMessage(event, {
      origin: parentOrigin,
      source: window.parent,
    });
    if (message.ok) {
      render(message.value).catch((error: unknown) => {
        if (current) {
          fail(current, runtimeError("render", error));
        }
      });
    }
  });

  // Errors after the render settled: event handlers, timers, promises.
  const onRuntimeError = (error: unknown) => {
    if (current) {
      fail(current, runtimeError("render", error));
    }
  };
  window.addEventListener("error", (event) =>
    onRuntimeError(event.error ?? event.message)
  );
  window.addEventListener("unhandledrejection", (event) =>
    onRuntimeError(event.reason)
  );

  let reported = -1;
  new ResizeObserver(() => {
    const height = Math.min(
      MAX_FRAME_HEIGHT,
      Math.ceil(container.getBoundingClientRect().height)
    );
    if (height !== reported) {
      reported = height;
      post({ channel: RUNTIME_CHANNEL, height, type: "resize" });
    }
  }).observe(container);

  post({ channel: RUNTIME_CHANNEL, type: "ready" });
};

if (root && parent.ok) {
  start(root, parent.value);
} else {
  // Opened without `?parent=`: there's nobody to talk to.
  console.error("The artifact runtime needs ?parent=<app origin>.");
}
