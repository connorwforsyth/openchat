import { loadConfig } from "@workspace/config/load";
import {
  defaultTermsConfig,
  resolveTerms,
  type Terms,
  type TermsConfig,
} from "@workspace/config/terms";

// `terms:` from app.config.yaml (191), read once per process like the public
// config. A missing or invalid file means the defaults: the bad-config
// notice is the layout's job, and names alone must never stop a page.

let loading: Promise<TermsConfig> | undefined;

const load = async (): Promise<TermsConfig> => {
  try {
    const loaded = await loadConfig();
    return loaded.ok ? loaded.value.config.terms : defaultTermsConfig;
  } catch {
    return defaultTermsConfig;
  }
};

/** The terms in `locale`'s words. */
export const getTerms = async (locale: string): Promise<Terms> => {
  loading ??= load();
  return resolveTerms(await loading, locale);
};
