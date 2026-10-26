import { slideIdSchema } from "@workspace/artifacts-kit/kinds/presentation/content";
import { slideTargetSchema } from "@workspace/artifacts-kit/kinds/presentation/edit-target";
import { REACT_IMPORTS } from "@workspace/artifacts-kit/kinds/react";
import { artifactKindSchema } from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import { elementStyleSchema, themeColorSchema } from "./editor/style";

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
  // Slides on the main page, compiled like React (164).
  "presentation",
  "react",
  // On its own page (`site.html`), whose CSP lets in the instance's public
  // origins (125).
  "site",
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

/**
 * How a deck lays out (164): `overview`, every slide down the page (the
 * default); `rail`, packed small for the slides editor's sorter; `slide`,
 * one slide fitted to the frame, for the editor's canvas.
 */
export const deckViewSchema = z.enum(["overview", "rail", "slide"]);
export type DeckView = z.infer<typeof deckViewSchema>;

/** Host → frame: render this artifact, replacing whatever is showing. */
export const renderRequestSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  code: z.string().max(MAX_CODE_LENGTH),
  /**
   * The artifact's file name (`Counter.tsx`): React elements are stamped
   * `data-src="<fileName>:<line>"` for the Annotate wave (D16).
   */
  fileName: z.string().min(1).max(256),
  /** The slide shown. */
  focus: slideIdSchema.optional(),
  /** Echoed back on `rendered` and `error`, so stale replies are dropped. */
  id: renderIdSchema,
  /** Whether a click on the slide picks an element in it, to edit. */
  inspect: z.boolean().optional(),
  kind: runtimeKindSchema,
  /** The element picked before this render, picked again once it's drawn. */
  selection: slideTargetSchema.nullable().optional(),
  theme: runtimeThemeSchema,
  title: z.string().max(200),
  type: z.literal("render"),
  /** A deck's layout; the rest is for its `slide` view. */
  view: deckViewSchema.optional(),
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

/** How the presenter moves through a deck (164), or in and out of presenting. */
export const presentActionSchema = z.enum([
  "enter",
  "exit",
  "first",
  "last",
  "next",
  "previous",
]);
export type PresentAction = z.infer<typeof presentActionSchema>;

/** The files a deck exports to (164). */
export const exportFormatSchema = z.enum(["pdf", "pptx"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/** Host → frame: present the deck on screen (`id` is its render). */
export const presentRequestSchema = z.object({
  action: presentActionSchema,
  channel: z.literal(RUNTIME_CHANNEL),
  id: renderIdSchema,
  type: z.literal("present"),
});
export type PresentRequest = z.infer<typeof presentRequestSchema>;

/** Host → frame: make the deck on screen into a file; answered by `exported`. */
export const exportRequestSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  format: exportFormatSchema,
  id: renderIdSchema,
  /** Echoed back, so the host matches the file to its click. */
  request: renderIdSchema,
  type: z.literal("export"),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

/**
 * Host → frame: in a deck's `slide` view, show `focus` and pick
 * `selection` in it, without drawing the deck again.
 */
export const selectRequestSchema = z.object({
  channel: z.literal(RUNTIME_CHANNEL),
  focus: slideIdSchema,
  id: renderIdSchema,
  selection: slideTargetSchema.nullable(),
  type: z.literal("select"),
});
export type SelectRequest = z.infer<typeof selectRequestSchema>;

/** Every message the host sends. */
export const hostMessageSchema = z.discriminatedUnion("type", [
  renderRequestSchema,
  presentRequestSchema,
  exportRequestSchema,
  selectRequestSchema,
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

/** The largest exported file the host accepts from the frame. */
export const MAX_EXPORT_BYTES = 50_000_000;
const MAX_NOTES_LENGTH = 20_000;

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

/** The element a click picked in a slide. */
export const pickedElementSchema = z.object({
  /** Words the editor can rewrite, a picture, or anything else. */
  kind: z.enum(["box", "image", "text"]),
  style: elementStyleSchema,
  /** Its tag, lower case, as the inspector names it. */
  tag: z.string().max(40),
  target: slideTargetSchema,
  /** Its words, when they're one run of text the editor can rewrite. */
  text: z.string().max(10_000).nullable(),
  /** The deck theme's colours, to offer before a colour of one's own. */
  theme: z.array(themeColorSchema).max(20),
});
export type PickedElement = z.infer<typeof pickedElementSchema>;

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
  // Where the presenter is in a deck (164): its slide, how many of the
  // slide's steps show, and the slide's speaker notes.
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    id: renderIdSchema,
    notes: z.string().max(MAX_NOTES_LENGTH),
    presenting: z.boolean(),
    slide: z.number().int().min(0),
    slides: z.number().int().min(0),
    step: z.number().int().min(0),
    steps: z.number().int().min(0),
    type: z.literal("position"),
  }),
  // Where each slide sits in a `rail`, from the frame's top, so the sorter
  // lays its controls over them.
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    id: renderIdSchema,
    slides: z
      .array(
        z.object({
          height: z.number().min(0).max(MAX_FRAME_HEIGHT),
          top: z.number().min(0).max(MAX_FRAME_HEIGHT),
        })
      )
      .max(100),
    type: z.literal("layout"),
  }),
  // What a click picked in the `slide` view (`null`: nothing, or Escape),
  // and again after each render while it stays picked. The deck's own code
  // runs in the frame and can post this too, so it's a claim: the editor
  // decides what to believe (`presentation/pick.ts`), and the frame never
  // sends edits.
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    element: pickedElementSchema.nullable(),
    id: renderIdSchema,
    type: z.literal("picked"),
  }),
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    data: z
      .instanceof(Uint8Array)
      .refine((data) => data.byteLength <= MAX_EXPORT_BYTES),
    format: exportFormatSchema,
    id: renderIdSchema,
    request: renderIdSchema,
    type: z.literal("exported"),
  }),
  z.object({
    channel: z.literal(RUNTIME_CHANNEL),
    id: renderIdSchema,
    message: z.string().max(MAX_MESSAGE_LENGTH),
    request: renderIdSchema,
    type: z.literal("export-failed"),
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

/**
 * The URL the panel loads: the runtime, told which origin will talk to it.
 * Sites (125) have a page of their own, because their CSP differs: it lets
 * in the instance's public origins, which no other kind may reach.
 */
export const runtimeUrl = (
  runtimeOrigin: string,
  parentOrigin: string,
  kind?: RuntimeKind
) =>
  `${runtimeOrigin}/${kind === "site" ? "site.html" : ""}?${new URLSearchParams({ parent: parentOrigin })}`;

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
