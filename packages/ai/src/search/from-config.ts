import type { AppConfig } from "@workspace/config/schema";
import { err, ok, type Result } from "@workspace/shared/result";

import type { SearchBackend } from "../ports/search-backend";
import {
  createBraveBackend,
  createExaBackend,
  createSearxngBackend,
  createTavilyBackend,
} from "./backends";
import type { FetchFunction } from "./http";

// The web search backend app.config.yaml `search` asks for (D23). A key or
// URL can come from the YAML (usually `${ENV}` interpolation) or straight
// from the environment, so `.env` alone is enough. Anything missing makes
// the backend unavailable with a reason, never a boot failure; without a
// backend there's no `web_search` tool, and models with native search still
// have theirs.

export type Env = Readonly<Record<string, string | undefined>>;

/** Environment fallbacks, used when the YAML block has no value. */
export const SEARCH_ENV = {
  brave: "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
  searxng: "SEARXNG_URL",
  tavily: "TAVILY_API_KEY",
} as const;

export interface SearchBackendUnavailable {
  readonly backend: string;
  readonly message: string;
}

const fromEnv = (env: Env, name: string): string | undefined =>
  env[name]?.trim() || undefined;

export const createSearchBackend = (
  config: Pick<AppConfig, "search">,
  {
    env = process.env,
    fetch,
  }: { readonly env?: Env; readonly fetch?: FetchFunction } = {}
): Result<SearchBackend, SearchBackendUnavailable> => {
  const { search } = config;
  // SearXNG is the default backend when its URL is in the environment (the
  // compose `search` profile), even if the YAML leaves `backend` unset.
  const backend =
    search.backend === "none" && fromEnv(env, SEARCH_ENV.searxng)
      ? "searxng"
      : search.backend;

  const missing = (what: string) =>
    err({
      backend,
      message: `web search backend "${backend}" has no ${what}`,
    });

  switch (backend) {
    case "none":
      return err({ backend, message: "no web search backend is configured" });
    case "searxng": {
      const url = search.searxng?.url ?? fromEnv(env, SEARCH_ENV.searxng);
      if (!url) {
        return missing(`URL (search.searxng.url or ${SEARCH_ENV.searxng})`);
      }
      if (!URL.canParse(url)) {
        return missing(`valid URL in ${SEARCH_ENV.searxng}`);
      }
      return ok(createSearxngBackend({ fetch, url }));
    }
    case "brave":
    case "tavily":
    case "exa": {
      const apiKey =
        search[backend]?.apiKey ?? fromEnv(env, SEARCH_ENV[backend]);
      if (!apiKey) {
        return missing(
          `API key (search.${backend}.apiKey or ${SEARCH_ENV[backend]})`
        );
      }
      const create = {
        brave: createBraveBackend,
        exa: createExaBackend,
        tavily: createTavilyBackend,
      }[backend];
      return ok(create({ apiKey, fetch }));
    }
    default:
      return backend satisfies never;
  }
};
