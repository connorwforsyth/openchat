import { REACT_IMPORTS } from "@workspace/artifacts-kit/kinds/react";
import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// The wire protocol between the artifacts panel and the artifact runtime
// (`apps/artifacts`, D24): a static page on its own origin that the panel
// loads in a sandboxed iframe and sends artifact code to over `postMessage`.
// Both sides parse every message with these schemas; neither trusts the
// other beyond them.
//
// It lives here, in the host, and the runtime imports it. (It's a `.tsx`
// file only because the package exports `./artifacts/*` as `.tsx`.)

/** Namespaces our messages so either side ignores anything else it receives. */
export const RUNTIME_CHANNEL = "artifact-runtime/1";

/** The artifact kinds the runtime renders; the rest never reach it. */
export const runtimeKindSchema = artifactKindSchema.extract([
  "html",
  "mermaid",
  "react",
  "svg",
]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const isRuntimeKind = (kind: string): kind is RuntimeKind =>
  runtimeKindSchema.safeParse(kind).success;

/**
 * What a React artifact may import: the React kind's list
 * (`@workspace/artifacts-kit`). The runtime bundles these, so previews need
 * no network (D24); anything else fails with an `import` error.
 */
export const RUNTIME_IMPORTS = REACT_IMPORTS;

export const runtimeThemeSchema = z.enum(["light", "dark"]);
export type RuntimeTheme = z.infer<typeof runtimeThemeSchema>;

/** The largest artifact the panel sends; the runtime rejects anything bigger. */
export const MAX_CODE_LENGTH = 1_000_000;
const MAX_MESSAGE_LENGTH = 4000;
/** Taller than any real preview; stops a frame from asking for a huge height. */
export const MAX_FRAME_HEIGHT = 20_000;

const renderIdSchema = z.string().min(1).max(64);

/** Host → frame: render this artifact, replacing whatever is showing. */
export const renderRequestSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  code: z.string().max(MAX_CODE_LENGTH),
  /**
   * The artifact's file name (`Counter.tsx`): React elements are stamped
   * `data-src="<fileName>:<line>"` for the Annotate wave (D16).
   */
  fileName: z.string().min(1).max(256),
  /** Echoed back on `rendered` and `error`, so stale replies are dropped. */
  id: renderIdSchema,
  kind: runtimeKindSchema,
  theme: runtimeThemeSchema,
  title: z.string().max(200),
  type: z.literal("render"),
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

/** Every message the host sends; one for now, a union once Annotate lands. */
export const hostMessageSchema = renderRequestSchema;
export type HostMessage = z.infer<typeof hostMessageSchema>;

/**
 * Why a render failed. The panel words each one itself (the frame has no
 * catalog); `message` is the raw detail, shown as code.
 * - `syntax`: the code didn't parse (TSX or Mermaid).
 * - `import`: it imports a module that isn't on the allowlist.
 * - `export`: a React artifact with no default export to render.
 * - `render`: it threw while running, rendering or handling an event.
 */
export const runtimeErrorKindSchema = z.enum([
  "syntax",
  "import",
  "export",
  "render",
]);
export type RuntimeErrorKind = z.infer<typeof runtimeErrorKindSchema>;

export const runtimeErrorSchema = z.object({
  kind: runtimeErrorKindSchema,
  message: z.string().max(MAX_MESSAGE_LENGTH),
});
export type RuntimeError = z.infer<typeof runtimeErrorSchema>;

/** Frame → host. */
export const frameMessageSchema = z.discriminatedUnion("type", [
  z.object({ channel: z.literal(RUNTIME_CHANNEL), type: z.literal("ready") }),
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    id: renderIdSchema,
    type: z.literal("rendered"),
  }),
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    error: runtimeErrorSchema,
    /** The render it belongs to, including errors after it settled (a click). */
    id: renderIdSchema,
    type: z.literal("error"),
  }),
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    height: z.number().int().min(0).max(MAX_FRAME_HEIGHT),
    type: z.literal("resize"),
  }),
]);
export type FrameMessage = z.infer<typeof frameMessageSchema>;

/** The parts of a `MessageEvent` the checks read, so tests can fake one. */
export interface IncomingMessage {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export type MessageRejection = "channel" | "origin" | "shape" | "source";

const OPAQUE_ORIGIN = "null";

const onChannel = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  "channel" in data &&
  data.channel === RUNTIME_CHANNEL;

/**
 * A message the frame received, accepted only from the window that embeds
 * it, on the origin that window said it has (`?parent=`).
 */
export const readHostMessage = (
  event: IncomingMessage,
  expected: { readonly origin: string; readonly source: unknown }
): Result<HostMessage, MessageRejection> => {
  if (event.source !== expected.source) {
    return err("source");
  }
  if (event.origin !== expected.origin) {
    return err("origin");
  }
  if (!onChannel(event.data)) {
    return err("channel");
  }
  const parsed = hostMessageSchema.safeParse(event.data);
  return parsed.success ? ok(parsed.data) : err("shape");
};

/**
 * A message the host received, accepted only from its own preview frame.
 * `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an
 * opaque origin, so its messages arrive from `"null"` whatever URL it loaded;
 * the window identity is what ties a message to our frame.
 */
export const readFrameMessage = (
  event: IncomingMessage,
  frame: unknown
): Result<FrameMessage, MessageRejection> => {
  if (frame === null || frame === undefined || event.source !== frame) {
    return err("source");
  }
  if (event.origin !== OPAQUE_ORIGIN) {
    return err("origin");
  }
  if (!onChannel(event.data)) {
    return err("channel");
  }
  const parsed = frameMessageSchema.safeParse(event.data);
  return parsed.success ? ok(parsed.data) : err("shape");
};

/** An `http(s)` origin, or an error for anything else (paths are dropped). */
export const parseOrigin = (value: string): Result<string, "invalid"> => {
  if (!URL.canParse(value)) {
    return err("invalid");
  }
  const { origin, protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:"
    ? ok(origin)
    : err("invalid");
};

/**
 * The runtime's origin from config (`ARTIFACTS_ORIGIN`). Unset or invalid
 * means no runtime: HTML and SVG fall back to `srcdoc` and React and Mermaid
 * show their source, so an empty `.env` still works.
 */
export const runtimeOriginFrom = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = parseOrigin(trimmed);
  return parsed.ok ? parsed.value : null;
};

/** The URL the panel loads: the runtime, told which origin will talk to it. */
export const runtimeUrl = (runtimeOrigin: string, parentOrigin: string) =>
  `${runtimeOrigin}/?${new URLSearchParams({ parent: parentOrigin })}`;

/** The runtime's view of `runtimeUrl`: the parent origin it should trust. */
export const parentOriginFrom = (
  search: string
): Result<string, "missing" | "invalid"> => {
  const parent = new URLSearchParams(search).get("parent");
  if (!parent) {
    return err("missing");
  }
  const parsed = parseOrigin(parent);
  // Only a bare origin: `?parent=https://app.example/anything` is a mistake.
  return parsed.ok && parsed.value === parent ? parsed : err("invalid");
};
