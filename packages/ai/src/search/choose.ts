import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { AppConfig, ProviderType } from "@workspace/config/schema";
import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { Tool } from "ai";

import type { SearchBackend } from "../ports/search-backend";
import { createWebSearchTool } from "./web-search-tool";

// Which web search a turn gets (D23): the provider's built-in search when
// the model supports it and the admin allows it (`search.native`, and the
// org's say), otherwise our `web_search` tool over the configured backend,
// otherwise none. Either way the tool is registered as `web_search`, so the
// retrieval gate and the approval rules treat both the same.
//
// Native tools come from the providers' default instances only for their
// definitions: a provider-defined tool is a name and arguments, executed by
// whichever instance (and key) the run's model uses.

const CLAUDE_WITHOUT_SEARCH = /^claude-(instant|2|3-(opus|sonnet|haiku))/;
const OPENAI_WITH_SEARCH = /^(gpt-4o|gpt-4\.1|gpt-5|o3|o4)/;
const GEMINI_WITH_SEARCH = /^gemini-(2|3)/;

/** Searches allowed per turn with native search; ours is bounded by the step limit. */
const NATIVE_MAX_USES = 5;

/**
 * Whether the provider's built-in web search works with this model. Kept
 * conservative: a model we're unsure of gets our tool, which always works.
 */
export const supportsNativeWebSearch = (
  providerType: ProviderType,
  modelId: string
): boolean => {
  const id = modelId.toLowerCase();
  switch (providerType) {
    case "anthropic":
      // Claude 3.5 Haiku, 3.7 Sonnet and every model since; not the 3.0 family.
      return id.startsWith("claude-") && !CLAUDE_WITHOUT_SEARCH.test(id);
    case "openai":
      // The Responses API's `web_search`; not the nano models.
      return OPENAI_WITH_SEARCH.test(id) && !id.includes("nano");
    case "google":
      return GEMINI_WITH_SEARCH.test(id);
    case "azure":
    case "bedrock":
    case "openai-compatible":
      return false;
    default:
      return providerType satisfies never;
  }
};

const nativeTool = (
  providerType: ProviderType,
  locale: string | undefined
): Tool | null => {
  switch (providerType) {
    case "anthropic":
      return anthropic.tools.webSearch_20250305({ maxUses: NATIVE_MAX_USES });
    case "openai":
      return openai.tools.webSearch({
        ...(locale?.includes("-")
          ? {
              userLocation: {
                country: locale.split("-")[1]?.toUpperCase(),
                type: "approximate" as const,
              },
            }
          : {}),
      });
    case "google":
      return google.tools.googleSearch({});
    default:
      return null;
  }
};

export type WebSearchChoice =
  | {
      readonly kind: "native";
      readonly provider: ProviderType;
      readonly tool: Tool;
    }
  | { readonly backend: string; readonly kind: "tool"; readonly tool: Tool }
  | {
      readonly kind: "none";
      readonly reason: "disabled" | "no_backend";
    };

export interface ChooseWebSearchInput {
  /** `createSearchBackend`'s result, or `null` when there's none. */
  readonly backend: SearchBackend | null;
  readonly config: Pick<AppConfig, "features" | "providers" | "search">;
  readonly locale?: string;
  /** The model this turn runs on (a resolved ref, not an alias). */
  readonly model: ModelRef;
  /** The org's policy on top of `search.native`; it can only narrow it. */
  readonly nativeAllowed?: boolean;
  readonly safeSearch?: boolean;
}

export const chooseWebSearch = ({
  backend,
  config,
  locale,
  model,
  nativeAllowed = true,
  safeSearch,
}: ChooseWebSearchInput): WebSearchChoice => {
  if (!config.features.webSearch) {
    return { kind: "none", reason: "disabled" };
  }
  const parsed = parseModelRef(model);
  const providerType = parsed
    ? config.providers[parsed.provider]?.type
    : undefined;
  if (
    parsed &&
    providerType &&
    config.search.native &&
    nativeAllowed &&
    supportsNativeWebSearch(providerType, parsed.modelId)
  ) {
    const tool = nativeTool(providerType, locale);
    if (tool) {
      return { kind: "native", provider: providerType, tool };
    }
  }
  return backend
    ? {
        backend: backend.id,
        kind: "tool",
        tool: createWebSearchTool({ backend, locale, safeSearch }),
      }
    : { kind: "none", reason: "no_backend" };
};
