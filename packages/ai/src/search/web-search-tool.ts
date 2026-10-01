import type { Tool } from "ai";
import type { SearchBackend } from "../ports/search-backend";
import { toAiSdkTool } from "../tools/registry/to-ai-sdk";
import { webSearch } from "../tools/registry/web-search";

// `web_search` is defined in the tool registry (`tools/registry/web-search.ts`,
// 080). This factory stays for one release so callers keep working: it binds
// the definition to a backend and hands back the AI SDK tool.

// biome-ignore lint/performance/noBarrelFile: the old import path keeps working for one release (080).
export {
  type WebSearchToolOutput,
  webSearchToolInputSchema,
  webSearchToolOutputSchema,
} from "../tools/registry/web-search";

export interface WebSearchToolOptions {
  readonly backend: SearchBackend;
  /** The user's locale, as a BCP 47 tag. */
  readonly locale?: string;
  /** Instance or org policy; the model can't turn it off. */
  readonly safeSearch?: boolean;
}

export const createWebSearchTool = ({
  backend,
  locale,
  safeSearch = true,
}: WebSearchToolOptions): Tool =>
  toAiSdkTool(webSearch, { ports: { backend, locale, safeSearch } });
