import type { ProviderConfig } from "@workspace/config/schema";
import { modelCapabilitySchema } from "@workspace/contract/schemas/models";
import type { z } from "zod";

// What a configured model can take in (D3), for the picker's badges and for
// deciding how a chat's attachments reach it (044): a file part only when
// the model reads that kind of file; otherwise the file is ingested and
// `file_search` answers from it. There is no model catalog, so this goes by
// provider: the native APIs read images and PDFs; an `openai-compatible`
// server (Ollama, vLLM, a gateway) is assumed to read neither unless its
// `options.capabilities` says so, like `capabilities: "vision, files"`.

export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

const NATIVE: readonly ModelCapability[] = ["tools", "vision", "files"];
const COMPATIBLE: readonly ModelCapability[] = ["tools"];
const LIST_SEPARATORS = /[\s,]+/;

/** `options.capabilities`, when set: the listed capabilities it names. */
const declared = (
  config: ProviderConfig
): readonly ModelCapability[] | undefined => {
  const raw = config.options.capabilities;
  if (raw === undefined) {
    return;
  }
  return raw.split(LIST_SEPARATORS).flatMap((entry) => {
    const parsed = modelCapabilitySchema.safeParse(entry.trim());
    return parsed.success ? [parsed.data] : [];
  });
};

/** A configured provider's models' capabilities. Pure. */
export const providerCapabilities = (
  config: ProviderConfig
): readonly ModelCapability[] =>
  declared(config) ??
  (config.type === "openai-compatible" ? COMPATIBLE : NATIVE);

/**
 * Whether a model with `capabilities` reads a file of `mediaType` as a file
 * part: images need `vision`, PDFs need `files`. Anything else (Word, CSV,
 * text) goes through ingestion and `file_search` instead.
 */
export const acceptsFile = (
  capabilities: readonly ModelCapability[],
  mediaType: string
): boolean => {
  const type = mediaType.toLowerCase();
  if (type.startsWith("image/")) {
    return capabilities.includes("vision");
  }
  if (type === "application/pdf") {
    return capabilities.includes("files");
  }
  return false;
};
