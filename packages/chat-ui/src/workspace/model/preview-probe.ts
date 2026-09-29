import { z } from "zod";

// Is anything answering on a preview's port? The preview lives on the
// sandbox preview origin (D24), and its proxy only lets an opaque origin
// read its responses (`previewCors` in apps/sandbox-runner): the error it
// sends when nothing listens has no CORS headers at all. So the check runs
// where the preview itself would, in a sandboxed `srcdoc` frame (origin
// "null"): a fetch that resolves means the app answered; one that throws
// means nothing is running there yet.

/** How long a preview gets to answer before the panel says nothing is running. */
export const PREVIEW_PROBE_TIMEOUT_MS = 10_000;

const probeReplySchema = z.object({
  answering: z.boolean(),
  probe: z.string(),
});

// JSON is valid JavaScript, but `</script>` inside it would end the script.
const scriptSafe = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

/** The probe frame's document: fetch `url`, then tell the parent. */
export const probeDocument = (url: string, token: string): string =>
  `<!doctype html><script>(function(){var u=${scriptSafe(url)},p=${scriptSafe(
    token
  )};function tell(a){parent.postMessage({probe:p,answering:a},"*")}fetch(u,{cache:"no-store"}).then(function(){tell(true)},function(){tell(false)})})()</script>`;

/** A probe frame's answer, if `data` is one for `token`. */
export const readProbeReply = (
  data: unknown,
  token: string
): boolean | null => {
  const parsed = probeReplySchema.safeParse(data);
  return parsed.success && parsed.data.probe === token
    ? parsed.data.answering
    : null;
};

/** Resolves whether `url` answers, from an invisible opaque-origin frame. */
export const probePreview = (
  url: string,
  timeoutMs = PREVIEW_PROBE_TIMEOUT_MS
): Promise<boolean> =>
  new Promise((resolve) => {
    const token = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = probeDocument(url, token);
    let timer = 0;
    const finish = (answering: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(answering);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) {
        return;
      }
      const answering = readProbeReply(event.data, token);
      if (answering !== null) {
        finish(answering);
      }
    };
    window.addEventListener("message", onMessage);
    timer = window.setTimeout(() => finish(false), timeoutMs);
    document.body.append(frame);
  });
