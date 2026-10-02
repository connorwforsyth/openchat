import type { ImageModelV4 } from "@ai-sdk/provider";
import { imageDataUrl } from "@workspace/artifacts-kit/kinds/image";
import type { ModelRef, TokenUsage } from "@workspace/contract/schemas/models";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { generateImage } from "ai";
import { z } from "zod";

import {
  type ArtifactStore,
  artifactRefSchema,
  saveArtifact,
} from "./artifact-content";

// Image generation (138): what `generate_image` does, apart from the tool's
// own file. A call draws 1–4 images with the instance's image model (the AI
// SDK's `generateImage`, so the gateway, OpenAI, Google and any
// OpenAI-compatible server all work), writes each into the chat's workspace
// as `images/<slug>-<n>.<ext>`, and saves each as an `image` artifact. Every
// port is optional except the model and the artifact store: a chat whose
// workspace is off still gets its images, as artifacts only.

/** The most images one call draws. */
export const MAX_IMAGES = 4;

/** Where a call's images go in the workspace. */
export const IMAGE_DIR = "images";

const SIZE = /^\d{2,4}x\d{2,4}$/;
const ASPECT = /^\d{1,2}:\d{1,2}$/;

export const generateImageInputSchema = z.object({
  aspectRatio: z
    .string()
    .regex(ASPECT, "width:height, like 16:9")
    .optional()
    .describe(
      "The shape, as width:height (1:1, 16:9, 9:16), when the user asks for one and not for a size."
    ),
  count: z
    .int()
    .min(1)
    .max(MAX_IMAGES)
    .optional()
    .describe(`How many images to make, 1 to ${MAX_IMAGES}; 1 unless asked.`),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      "What the image shows, in detail: subject, setting, style, lighting, composition. For an edit, the change to make."
    ),
  size: z
    .string()
    .regex(SIZE, "widthxheight in pixels, like 1024x1024")
    .optional()
    .describe(
      "The size in pixels, as widthxheight (1024x1024), only when the user asks for one."
    ),
  source: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe(
      "To edit an image instead of making a new one: its path in the workspace, like images/harbour-1.png."
    ),
});
export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

export const generatedImageSchema = z.object({
  artifact: artifactRefSchema.nullable(),
  mediaType: z.string(),
  /** Its path in the workspace; `null` when the chat's workspace is off. */
  path: z.string().nullable(),
});
export type GeneratedImage = z.infer<typeof generatedImageSchema>;

export const generateImageOutputSchema = z.discriminatedUnion("status", [
  z.object({
    images: z.array(generatedImageSchema),
    /** The image model's name as people say it. */
    model: z.string(),
    prompt: z.string(),
    /** The workspace path of the image this call edited. */
    source: z.string().nullable(),
    status: z.literal("generated"),
  }),
  /** `source` names no file in the workspace. */
  z.object({ path: z.string(), status: z.literal("not_found") }),
  /** A hard budget is spent; nothing was drawn. */
  z.object({ status: z.literal("over_budget") }),
  z.object({ message: z.string(), status: z.literal("unavailable") }),
]);
export type GenerateImageOutput = z.infer<typeof generateImageOutputSchema>;

/** What the image model is asked for. */
export interface ImageRequest {
  readonly aspectRatio?: `${number}:${number}`;
  readonly count: number;
  readonly prompt: string;
  readonly signal?: AbortSignal;
  readonly size?: `${number}x${number}`;
  /** The image to edit, when it's an edit. */
  readonly source?: Uint8Array;
}

export interface DrawnImage {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface DrawnImages {
  readonly images: readonly DrawnImage[];
  /** What the provider reported; zeros when it reported nothing. */
  readonly usage: TokenUsage;
}

/**
 * The image model a run draws with, bound by the server for the caller's
 * keys (D17); `null` when no image model is configured or keyed.
 */
export interface ImageDrawer {
  readonly displayName: string;
  readonly draw: (request: ImageRequest) => AsyncResult<DrawnImages, string>;
  readonly target: ModelRef;
}

export type WorkspaceReadResult = Result<
  Uint8Array,
  { readonly message?: string; readonly type: "not_found" | "unavailable" }
>;

/** The chat's workspace, as the tool reaches it. */
export interface ImageWorkspace {
  readonly readFile: (path: string) => Promise<WorkspaceReadResult>;
  readonly writeFile: (
    path: string,
    bytes: Uint8Array
  ) => AsyncResult<void, { readonly message: string }>;
}

/** What `generate_image` is bound to for one run. */
export interface ImagePorts {
  readonly artifacts: ArtifactStore;
  /** The run's image model; `null` when there's none for these keys. */
  readonly drawer: ImageDrawer | null;
  /** Records what a call cost (`models.prices`), so budgets see it. */
  readonly record?: (charge: {
    readonly count: number;
    readonly model: ModelRef;
    readonly usage: TokenUsage;
  }) => Promise<void>;
  /** `false` when a hard budget is spent; left out, nothing is checked. */
  readonly withinBudget?: () => Promise<boolean>;
  /** The chat's workspace; left out when it's off for this turn. */
  readonly workspace?: ImageWorkspace;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A file extension for an image's media type; `png` for anything else. */
export const imageExtension = (mediaType: string): string =>
  EXTENSIONS[mediaType] ?? "png";

const NOT_SLUG = /[^a-z0-9]+/g;
const MARKS = /\p{M}+/gu;
const EDGE_DASHES = /^-+|-+$/g;
const SLUG_WORDS = 6;
const SLUG_MAX = 48;

/** A short file name from the prompt: its first few words, kebab-case. Pure. */
export const imageSlug = (prompt: string): string => {
  const words = prompt
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(NOT_SLUG, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, SLUG_WORDS);
  const slug = words.join("-").slice(0, SLUG_MAX).replace(EDGE_DASHES, "");
  return slug || "image";
};

const TITLE_MAX = 80;
const WHITESPACE = /\s+/g;

/** An artifact title from the prompt, numbered when a call makes several. Pure. */
export const imageTitle = (
  prompt: string,
  index: number,
  count: number
): string => {
  const line = prompt.replace(WHITESPACE, " ").replaceAll('"', "'").trim();
  const short =
    line.length > TITLE_MAX
      ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : line;
  const title = short || "Image";
  return count > 1 ? `${title} (${index + 1})` : title;
};

/** How many numbers past the call's own are probed for free names. */
const PROBE_SPARE = 16;

/**
 * Free `images/<slug>-<n>.<ext>` paths, one per extension, so a call never
 * overwrites an earlier picture. The numbers are probed together; a
 * workspace that can't be read is written to at the first ones.
 */
const freePaths = async (
  workspace: ImageWorkspace,
  slug: string,
  extensions: readonly string[]
): Promise<string[]> => {
  const first = extensions[0] ?? "png";
  const numbers = Array.from(
    { length: extensions.length + PROBE_SPARE },
    (_, index) => index + 1
  );
  const probed = await Promise.all(
    numbers.map(async (n) => {
      const read = await workspace.readFile(
        `${IMAGE_DIR}/${slug}-${n}.${first}`
      );
      return read.ok ? null : n;
    })
  );
  const free = probed.filter((n): n is number => n !== null);
  // All taken: carry on past the probed ones.
  const last = numbers.length;
  return extensions.map(
    (extension, index) =>
      `${IMAGE_DIR}/${slug}-${free[index] ?? last + index + 1}.${extension}`
  );
};

const base64Of = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

/** Draws, saves and records one call. Every failure is a result the model reads. */
export const runGenerateImage = async (
  ports: ImagePorts,
  input: GenerateImageInput,
  signal?: AbortSignal
): Promise<GenerateImageOutput> => {
  const { drawer, workspace } = ports;
  if (!drawer) {
    return {
      message:
        "No image model is set up for this chat, so images can't be made here.",
      status: "unavailable",
    };
  }
  let source: Uint8Array | undefined;
  if (input.source) {
    if (!workspace) {
      return {
        message: "The workspace is off, so there's no image to edit.",
        status: "unavailable",
      };
    }
    const read = await workspace.readFile(input.source);
    if (!read.ok) {
      return read.error.type === "not_found"
        ? { path: input.source, status: "not_found" }
        : {
            message: read.error.message ?? "The workspace couldn't be read.",
            status: "unavailable",
          };
    }
    source = read.value;
  }
  if (ports.withinBudget && !(await ports.withinBudget())) {
    return { status: "over_budget" };
  }
  const count = input.count ?? 1;
  const drawn = await drawer.draw({
    count,
    prompt: input.prompt,
    signal,
    ...(input.aspectRatio
      ? { aspectRatio: input.aspectRatio as `${number}:${number}` }
      : {}),
    ...(input.size ? { size: input.size as `${number}x${number}` } : {}),
    ...(source ? { source } : {}),
  });
  if (!drawn.ok) {
    return { message: drawn.error, status: "unavailable" };
  }
  const images = drawn.value.images.slice(0, MAX_IMAGES);
  // Recorded before anything is saved: the provider has charged for it.
  await ports
    .record?.({
      count: images.length,
      model: drawer.target,
      usage: drawn.value.usage,
    })
    .catch(() => undefined);
  const slug = imageSlug(input.prompt);
  const paths = workspace
    ? await freePaths(
        workspace,
        slug,
        images.map((image) => imageExtension(image.mediaType))
      )
    : [];
  const saved = await Promise.all(
    images.map(async (image, index): Promise<GeneratedImage> => {
      const path = paths[index];
      const written =
        workspace && path ? await workspace.writeFile(path, image.bytes) : null;
      const artifact = await saveArtifact(ports.artifacts, {
        content: imageDataUrl(image.mediaType, base64Of(image.bytes)),
        kind: "image",
        language: null,
        title: imageTitle(input.prompt, index, images.length),
      });
      return {
        artifact: artifact.status === "saved" ? artifact.artifact : null,
        mediaType: image.mediaType,
        path: written?.ok && path ? path : null,
      };
    })
  );
  return {
    images: saved,
    model: drawer.displayName,
    prompt: input.prompt,
    source: input.source ?? null,
    status: "generated",
  };
};

/** What the model reads of a result. */
export const generateImageModelText = (output: GenerateImageOutput): string => {
  switch (output.status) {
    case "generated": {
      const paths = output.images
        .map((image) => image.path)
        .filter((path): path is string => path !== null);
      const where =
        paths.length > 0
          ? ` Saved in the workspace as ${paths.join(", ")}, and as artifacts.`
          : " Saved as artifacts.";
      return `Made ${output.images.length === 1 ? "1 image" : `${output.images.length} images`} with ${output.model}.${where} The user sees them in the reply; you can't see them, so don't describe them. To change one, call generate_image again with its path as \`source\`.`;
    }
    case "not_found":
      return `There's no image at ${output.path} in the workspace. Check the path (images are under ${IMAGE_DIR}/) and try again.`;
    case "over_budget":
      return "Not made: a spending budget for this chat is used up. Tell the user.";
    case "unavailable":
      return `Not made: ${output.message}`;
    default:
      return output satisfies never;
  }
};

const MESSAGE_MAX = 300;

/** A provider error as a short line the model and the user can read. */
const describeFailure = (cause: unknown, editing: boolean): string => {
  const name = cause instanceof Error ? cause.name : "";
  if (editing && name === "AI_UnsupportedFunctionalityError") {
    return "this image model can't edit images; make a new one instead.";
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const line = message.replace(WHITESPACE, " ").trim().slice(0, MESSAGE_MAX);
  return line
    ? `the image model failed (${line}).`
    : "the image model didn't answer.";
};

/**
 * Draws with an AI SDK image model. Never throws: a provider error (or one
 * that can't edit) is the `err` string the model reads.
 */
export const drawWith =
  (model: ImageModelV4) =>
  async (request: ImageRequest): AsyncResult<DrawnImages, string> => {
    try {
      const result = await generateImage({
        abortSignal: request.signal,
        model,
        n: request.count,
        prompt: request.source
          ? { images: [request.source], text: request.prompt }
          : request.prompt,
        ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
        ...(request.size ? { size: request.size } : {}),
      });
      return ok({
        images: result.images.map((image) => ({
          bytes: image.uint8Array,
          mediaType: image.mediaType || "image/png",
        })),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      });
    } catch (cause) {
      return err(describeFailure(cause, request.source !== undefined));
    }
  };
