import {
  type AnnotationTarget,
  asTarget,
  locateAt,
  nestedProbe,
  type ProbeRequest,
  readNestedAnswer,
  readProbeRequest,
} from "@workspace/chat-ui/artifacts/annotate/probe";
import { RUNTIME_CHANNEL } from "@workspace/chat-ui/artifacts/runtime-protocol";

// Annotate's question, answered in the runtime (night 2, decision 5): the
// host asks what is at a point the person marked, and the page says, in
// the terms a note uses (`locateAt`). A point over a page nested in this
// one (an HTML artifact, a site's page) is passed on to the script that
// page was given (`probeScript`), and its answer passed back. The runtime
// never asks on its own; it only answers.

/** How long a nested page has to answer before the runtime says nothing. */
const NESTED_TIMEOUT_MS = 400;

const askNested = (
  frame: HTMLIFrameElement,
  request: ProbeRequest
): Promise<AnnotationTarget | null> => {
  const page = frame.contentWindow;
  if (!page) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const finish = (target: AnnotationTarget | null) => {
      window.removeEventListener("message", listen);
      window.clearTimeout(timer);
      resolve(target);
    };
    const listen = (event: MessageEvent) => {
      const target = readNestedAnswer(event, page, request.request);
      if (target !== undefined) {
        finish(target);
      }
    };
    const timer = window.setTimeout(() => finish(null), NESTED_TIMEOUT_MS);
    window.addEventListener("message", listen);
    page.postMessage(nestedProbe(request, frame.getBoundingClientRect()), "*");
  });
};

const answer = (request: ProbeRequest): Promise<AnnotationTarget | null> => {
  const hit = document.elementFromPoint(request.x, request.y);
  if (hit instanceof HTMLIFrameElement) {
    return askNested(hit, request);
  }
  return Promise.resolve(
    asTarget(locateAt(request.x, request.y, request.width, request.height))
  );
};

/** Answers the embedding window's probes, on the origin it said it has. */
export const answerProbes = (parentOrigin: string) =>
  window.addEventListener("message", (event) => {
    const request = readProbeRequest(event, {
      origin: parentOrigin,
      source: window.parent,
    });
    if (!request.ok) {
      return;
    }
    answer(request.value)
      .catch(() => null)
      .then((target) =>
        window.parent.postMessage(
          {
            channel: RUNTIME_CHANNEL,
            request: request.value.request,
            target,
            type: "annotate-probed",
          },
          parentOrigin
        )
      );
  });
