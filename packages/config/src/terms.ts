import { z } from "zod";

// What the UI calls a feature, and where it lives (191). Code names a
// feature by one stable id (`mcp`); the words people see and the address
// segment come from `terms:` in app.config.yaml, so a fork can say
// "Plugins" at `/settings/plugins` without touching code. Pure and
// browser-safe: the server resolves terms for the request's locale and the
// client reads the result.

/** The stable ids of features with configurable names. */
export const termIdSchema = z.enum(["mcp"]);
export type TermId = z.infer<typeof termIdSchema>;

const wordSchema = z.string().trim().min(1).max(60);

/** A lowercase URL segment: `/settings/<slug>`. */
export const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "a lowercase URL segment, like `mcp`")
  .max(40);

const wordsSchema = z.strictObject({
  /** Plural, as a heading or a menu entry ("MCP servers"). */
  label: wordSchema,
  /** One of them ("MCP server"). */
  singular: wordSchema,
});

const termSchema = (defaults: z.infer<typeof wordsSchema> & { slug: string }) =>
  z
    .strictObject({
      label: wordSchema.default(defaults.label),
      /**
       * For languages that inflect: replaces `label` and `singular` when the
       * viewer's locale matches (`pt-BR`, then `pt`). Either may be left out.
       */
      locales: z.record(z.string().min(2), wordsSchema.partial()).default({}),
      singular: wordSchema.default(defaults.singular),
      slug: slugSchema.default(defaults.slug),
    })
    .prefault({});

export const termsSchema = z
  .strictObject({
    mcp: termSchema({
      label: "MCP servers",
      singular: "MCP server",
      slug: "mcp",
    }),
  })
  .prefault({});

export type TermsConfig = z.infer<typeof termsSchema>;

/** One feature's words for one locale, and its address segment. */
export const resolvedTermSchema = z.object({
  label: wordSchema,
  singular: wordSchema,
  slug: slugSchema,
});
export type Term = z.infer<typeof resolvedTermSchema>;

export const resolvedTermsSchema = z.record(termIdSchema, resolvedTermSchema);
export type Terms = Readonly<Record<TermId, Term>>;

/** The defaults: what an instance with no `terms:` block shows. */
export const defaultTermsConfig: TermsConfig = termsSchema.parse(undefined);

const localeOverride = (
  locales: TermsConfig[TermId]["locales"],
  locale: string
) => {
  const exact = locales[locale];
  if (exact) {
    return exact;
  }
  const [base] = locale.split("-");
  return base ? locales[base] : undefined;
};

/** Every term's words for `locale`, falling back to the configured ones. */
export const resolveTerms = (
  config: TermsConfig = defaultTermsConfig,
  locale = "en"
): Terms =>
  Object.fromEntries(
    termIdSchema.options.map((id) => {
      const { label, locales, singular, slug } = config[id];
      const override = localeOverride(locales, locale);
      return [
        id,
        {
          label: override?.label ?? label,
          singular: override?.singular ?? singular,
          slug,
        },
      ];
    })
  ) as Record<TermId, Term>;

export const defaultTerms: Terms = resolveTerms();

/**
 * Old addresses each feature answered to before it was configurable, so
 * links people saved keep working (they redirect to the configured slug).
 */
const legacySlugs: Readonly<Record<TermId, readonly string[]>> = {
  mcp: ["connectors"],
};

/** The address segment for `id`: its term's slug when it has one, else the id. */
export const slugFor = <Id extends string>(terms: Terms, id: Id): string =>
  termIdSchema.safeParse(id).success ? terms[id as TermId].slug : id;

/**
 * What a URL segment names, given the ids routed this way. `canonical`
 * false means the segment is the id or a legacy slug while the configured
 * slug differs: redirect to `slugFor(terms, id)`. Unknown: `null` (a 404).
 * An id that isn't a term routes by itself.
 */
export const idForSlug = <Id extends string>(
  terms: Terms,
  ids: readonly Id[],
  segment: string
): { readonly canonical: boolean; readonly id: Id } | null => {
  for (const id of ids) {
    if (slugFor(terms, id) === segment) {
      return { canonical: true, id };
    }
  }
  for (const id of ids) {
    const term = termIdSchema.safeParse(id);
    if (
      term.success &&
      (segment === id || legacySlugs[term.data].includes(segment))
    ) {
      return { canonical: false, id };
    }
  }
  return null;
};
