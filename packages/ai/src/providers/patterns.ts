import type { ProviderConfig } from "@workspace/config/schema";

// A provider's `include` / `exclude` globs over model ids (095). `*`
// matches any run of characters, `/` included (`anthropic/*` covers every
// Anthropic model on a gateway); `?` matches one; everything else is literal.

const SPECIAL = /[.+^${}()|[\]\\]/g;

const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob.replace(SPECIAL, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`
  );

/** Compiles the globs once; the result says whether a model id matches any. */
export const globMatcher = (
  globs: readonly string[]
): ((modelId: string) => boolean) => {
  const compiled = globs.map(globToRegExp);
  return (modelId) => compiled.some((pattern) => pattern.test(modelId));
};

/**
 * Whether a provider's patterns let `modelId` through: it matches `include`
 * (or `include` is empty) and doesn't match `exclude`. Pure.
 */
export const patternFilter = (
  config: Pick<ProviderConfig, "exclude" | "include">
): ((modelId: string) => boolean) => {
  const included = globMatcher(config.include);
  const excluded = globMatcher(config.exclude);
  return (modelId) =>
    (config.include.length === 0 || included(modelId)) && !excluded(modelId);
};
