import { featureFlagSchema } from "@workspace/contract/schemas/meta";
import {
  AUTO_MODEL,
  modelAliasSchema,
  modelRefSchema,
  modelSelectorSchema,
  parseModelRef,
  providerIdSchema,
} from "@workspace/contract/schemas/models";
import { sandboxProviderSchema } from "@workspace/contract/schemas/sandbox";
import { instancePolicySchema } from "@workspace/contract/schemas/tenancy";
import { z } from "zod";

import { DEFAULT_SITE_ORIGINS, isSiteOrigin } from "./sites";

// The `app.config.yaml` schema (PLAN.md §9, D18). The YAML sets instance-wide
// settings and limits; orgs choose within them in the database. Every section
// has defaults, so an empty or missing file still boots (D8: degrade, never
// crash). Objects are strict: a misspelt key is an error, not a silent no-op.
// Secrets arrive through `${ENV}` interpolation and are never written back.

/** Provider packages we wire natively; anything else is `openai-compatible`. */
export const nativeProviderTypes = [
  "anthropic",
  "openai",
  "google",
  "bedrock",
  "azure",
] as const;

export const providerTypeSchema = z.enum([
  ...nativeProviderTypes,
  "openai-compatible",
]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

const secret = z.string().min(1);

/**
 * One provider. `type` may be left out when the key names a native provider
 * (`anthropic:` means `type: anthropic`); it's filled in after parsing. A
 * missing `apiKey` isn't an error: the provider is listed but unavailable.
 */
const providerInputSchema = z.strictObject({
  apiKey: secret.optional(),
  baseURL: z.url().optional(),
  /**
   * Offer every model the provider's catalog lists (its `/models`, or
   * Ollama's tags), not only `models`. Off by default: whoever picks then
   * decides what's spent, so narrow it with `include` / `exclude`.
   */
  discover: z.boolean().default(false),
  /** How long a fetched catalog is reused, per provider and key. */
  discoverTtlSeconds: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60)
    .default(60 * 60),
  /**
   * Globs over model ids (`*` matches anything, `?` one character) that are
   * never offered or run, even when `include` matches. `models` and alias
   * targets stay valid regardless.
   */
  exclude: z.array(z.string().min(1)).default([]),
  headers: z.record(z.string(), z.string()).default({}),
  /**
   * Globs over model ids a chat may pick beyond `models` and aliases; empty
   * means any. Applies to discovered models and to refs typed by hand.
   */
  include: z.array(z.string().min(1)).default([]),
  /** Model ids to offer in the picker, beyond aliases. */
  models: z.array(z.string().min(1)).default([]),
  /** Provider-specific settings (Bedrock `region`, Azure `resourceName`, …). */
  options: z.record(z.string(), z.string()).default({}),
  type: providerTypeSchema.optional(),
});

export const providerConfigSchema = providerInputSchema.extend({
  type: providerTypeSchema,
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

const isNativeType = (id: string): id is (typeof nativeProviderTypes)[number] =>
  (nativeProviderTypes as readonly string[]).includes(id);

/** With no providers configured, try a local Ollama (AGENTS.md: agent features fall back to it). */
const defaultProviders = {
  ollama: {
    baseURL: "http://localhost:11434/v1",
    type: "openai-compatible" as const,
  },
};

const providersSchema = z
  .record(providerIdSchema, providerInputSchema)
  .prefault(defaultProviders)
  .transform((providers, context) => {
    const resolved: Record<string, ProviderConfig> = {};
    for (const [id, provider] of Object.entries(providers)) {
      const type = provider.type ?? (isNativeType(id) ? id : undefined);
      if (!type) {
        context.addIssue({
          code: "custom",
          message: `"${id}" isn't a built-in provider, so it needs a \`type\` (usually openai-compatible)`,
          path: [id, "type"],
        });
        continue;
      }
      if (type === "openai-compatible" && !provider.baseURL) {
        context.addIssue({
          code: "custom",
          message: "an openai-compatible provider needs a `baseURL`",
          path: [id, "baseURL"],
        });
      }
      if (provider.discover && (type === "azure" || type === "bedrock")) {
        context.addIssue({
          code: "custom",
          message: `${type} has no model catalog to discover; list its \`models\` instead`,
          path: [id, "discover"],
        });
      }
      resolved[id] = { ...provider, type };
    }
    return resolved;
  });

const brandSchema = z
  .strictObject({
    /** Desktop bundle id and mobile app id (reverse DNS). */
    appId: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/,
        "reverse-DNS, like `dev.example.app`"
      )
      .nullable()
      .default(null),
    favicon: z.string().min(1).nullable().default(null),
    logo: z.string().min(1).nullable().default(null),
    name: z.string().trim().min(1).max(60).default("Chat"),
    /** Deep-link scheme for desktop and mobile (`<scheme>://`). */
    urlScheme: z
      .string()
      .regex(/^[a-z][a-z0-9+.-]*$/, "a lowercase URL scheme")
      .nullable()
      .default(null),
  })
  .prefault({});

const oidcProviderSchema = z.strictObject({
  clientId: secret,
  clientSecret: secret,
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "a lowercase id"),
  issuer: z.url(),
  name: z.string().min(1),
  scopes: z.array(z.string()).default(["openid", "email", "profile"]),
});

const socialCredentialKeys: ReadonlySet<string> = new Set([
  "clientId",
  "clientSecret",
]);

/**
 * `github: { clientId: ${GITHUB_CLIENT_ID}, clientSecret: … }` with the
 * variables unset interpolates to `{}` (or half a pair). That is a provider
 * left off, like a provider without an `apiKey`, not a boot failure. Unknown
 * keys still fail, so a typo (`clientID`) is caught.
 */
const withoutHalfCredentials = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const keys = Object.keys(value);
  const onlyCredentials = keys.every((key) => socialCredentialKeys.has(key));
  return onlyCredentials && keys.length < socialCredentialKeys.size
    ? undefined
    : value;
};

const socialProviderSchema = z.preprocess(
  withoutHalfCredentials,
  z
    .strictObject({
      clientId: secret,
      clientSecret: secret,
    })
    .optional()
);

const DOMAIN = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

const authSchema = z
  .strictObject({
    /** For `signup: domain`: allowed email domains. */
    domains: z
      .array(z.string().regex(DOMAIN, "a domain, like `example.com`"))
      .default([]),
    /** For `signup: domain`: invites still work for other addresses. */
    invites: z.boolean().default(true),
    oidc: z.array(oidcProviderSchema).default([]),
    /** First user is admin, then invite-only (D22). */
    signup: z.enum(["open", "invite", "domain", "sso"]).default("invite"),
    social: z
      .strictObject({
        github: socialProviderSchema,
        google: socialProviderSchema,
      })
      .prefault({}),
  })
  .prefault({})
  .superRefine((auth, context) => {
    if (auth.signup === "domain" && auth.domains.length === 0) {
      context.addIssue({
        code: "custom",
        message: "`signup: domain` needs at least one entry in `domains`",
        path: ["domains"],
      });
    }
    if (auth.signup === "sso" && auth.oidc.length === 0) {
      context.addIssue({
        code: "custom",
        message: "`signup: sso` needs at least one `oidc` provider",
        path: ["oidc"],
      });
    }
  });

/**
 * Micro-USD per million tokens: the same integer micro-USD as `costMicros`
 * and budget limits (1 USD = 1_000_000), so `$3.00 per million tokens` is
 * `3000000`. The cap ($1M per million tokens) keeps a row's cost inside a
 * safe integer at any token count the database can hold.
 */
const priceMicrosSchema = z.int().min(0).max(1_000_000_000_000);

/** What one model charges. No price ships built in: a wrong one is worse than none. */
export const modelPriceSchema = z
  .strictObject({
    /**
     * Input tokens the provider read from its cache, where it reports them.
     * Left out, they cost the same as any other input token.
     */
    cachedInputMicros: priceMicrosSchema.optional(),
    /**
     * What one generated image costs, in micro-USD (138): `40000` is 4 cents.
     * For image models; added to whatever their tokens cost.
     */
    imageMicros: priceMicrosSchema.optional(),
    /** Left out only for an image model priced per image. */
    inputMicros: priceMicrosSchema.optional(),
    outputMicros: priceMicrosSchema.optional(),
  })
  .refine(
    (price) =>
      price.imageMicros !== undefined ||
      (price.inputMicros !== undefined && price.outputMicros !== undefined),
    "set `inputMicros` and `outputMicros`, or `imageMicros` for an image model"
  );
export type ModelPrice = z.infer<typeof modelPriceSchema>;

const ratingSchema = z.int().min(1).max(5);

/**
 * Image generation (138): the model `generate_image` draws with, and where
 * else image models come from. They are their own list and never reach the
 * chat picker. With no default and nothing discovered, no chat gets the tool.
 */
const imageModelsSchema = z
  .strictObject({
    /**
     * Whether a `generate_image` call asks first. Images cost more than a
     * reply, so it asks unless the instance says `auto`.
     */
    approval: z.enum(["ask", "auto"]).default("ask"),
    /** The image model calls use: a `provider:model` ref. */
    default: modelRefSchema.nullable().default(null),
    /**
     * Also list the image models a discovering provider's catalog names
     * (the gateway's `type: image`), after `default` and `models`; the first
     * one this context has a key for is used when `default` has none.
     */
    discover: z.boolean().default(false),
    /** More image models to offer, by ref, after `default`. */
    models: z.array(modelRefSchema).default([]),
  })
  .prefault({});

const modelsSchema = z
  .strictObject({
    /** Short names the UI shows instead of provider refs (`fast`, `strong`). */
    aliases: z
      .record(modelAliasSchema, modelRefSchema)
      .default({})
      .superRefine((aliases, context) => {
        if (AUTO_MODEL in aliases) {
          context.addIssue({
            code: "custom",
            message:
              "`auto` is reserved for Decider routing; pick another alias",
            path: [AUTO_MODEL],
          });
        }
      }),
    /** The Decider's per-turn routing between a cheap and a strong model (D15). */
    auto: z
      .strictObject({
        cheap: modelSelectorSchema.nullable().default(null),
        enabled: z.boolean().default(false),
        strong: modelSelectorSchema.nullable().default(null),
      })
      .prefault({})
      .superRefine((auto, context) => {
        for (const end of ["cheap", "strong"] as const) {
          if (auto[end] === AUTO_MODEL) {
            context.addIssue({
              code: "custom",
              message: "`auto` can't route to itself",
              path: [end],
            });
          }
        }
        if (auto.enabled && !(auto.cheap && auto.strong)) {
          context.addIssue({
            code: "custom",
            message: "`auto.enabled` needs both `cheap` and `strong`",
            path: [auto.cheap ? "strong" : "cheap"],
          });
        }
      }),
    /**
     * Names new chats: an alias or `provider:model` ref. `null` uses
     * `auto.cheap`, then `default`; `false` never calls a model. A chat no
     * model can name is titled from its first message.
     */
    conversationTitleModel: z
      .union([modelSelectorSchema, z.literal(false)])
      .nullable()
      .default(null),
    /** The model new chats start with; `null` picks the first available. */
    default: modelSelectorSchema.nullable().default(null),
    /**
     * A short "why pick this" under a model in the picker, keyed by alias or
     * `provider:model` ref (`fast: Quick everyday answers`). Beats what a
     * provider's catalog says; kept to one line of about 120 characters.
     */
    descriptions: z
      .record(modelSelectorSchema, z.string().trim().min(1))
      .default({}),
    image: imageModelsSchema,
    /**
     * Prices by `provider:modelId` ref (what an alias resolves to), used to
     * fill `costMicros` on usage rows. A model that isn't listed is unpriced:
     * its usage is recorded at cost 0 and counts toward no budget.
     */
    prices: z.record(modelRefSchema, modelPriceSchema).default({}),
    /**
     * How fast and how capable a model is, 1 (least) to 5 (most), for the
     * picker's preview bars (099), keyed by alias or `provider:model` ref
     * (`strong: { speed: 3, intelligence: 5 }`). Nothing is guessed: a model
     * with no rating shows no bar. The alias's rating beats its ref's.
     */
    ratings: z
      .record(
        modelSelectorSchema,
        z
          .strictObject({
            intelligence: ratingSchema.optional(),
            speed: ratingSchema.optional(),
          })
          .refine(
            (rating) =>
              rating.intelligence !== undefined || rating.speed !== undefined,
            "rate `speed`, `intelligence` or both"
          )
      )
      .default({}),
  })
  .prefault({});

const probability = z.number().min(0).max(1);

const deciderSchema = z
  .strictObject({
    adapter: z.enum(["llm-fallback", "jev", "none"]).default("llm-fallback"),
    /** Every decision goes to `decision_log` (D15); off only for local debugging. */
    logDecisions: z.boolean().default(true),
    /** `null` uses `models.auto.cheap`, then `models.default`. */
    model: modelSelectorSchema.nullable().default(null),
    thresholds: z
      .strictObject({
        autoRouteStrong: probability.default(0.6),
        needsRetrieval: probability.default(0.5),
        /** Risk score at or above which an `auto`-mode command asks first. */
        riskAsk: probability.default(0.3),
        /** Risk score at or above which it's blocked. */
        riskBlock: probability.default(0.7),
      })
      .prefault({})
      .refine((t) => t.riskAsk <= t.riskBlock, {
        message: "`riskAsk` must not exceed `riskBlock`",
        path: ["riskAsk"],
      }),
  })
  .prefault({});

const apiKeyBlock = z.strictObject({ apiKey: secret.optional() });

const searchSchema = z
  .strictObject({
    /** Our `web_search` tool's backend when the model has no native search (D23). */
    backend: z
      .enum(["none", "searxng", "brave", "tavily", "exa"])
      .default("none"),
    brave: apiKeyBlock.optional(),
    exa: apiKeyBlock.optional(),
    /** Use the provider's built-in search when the model supports it. */
    native: z.boolean().default(true),
    searxng: z.strictObject({ url: z.url() }).optional(),
    tavily: apiKeyBlock.optional(),
  })
  .prefault({})
  .superRefine((search, context) => {
    if (search.backend !== "none" && !search[search.backend]) {
      context.addIssue({
        code: "custom",
        message: `\`backend: ${search.backend}\` needs a \`${search.backend}:\` block`,
        path: [search.backend],
      });
    }
  });

const sandboxLimitsSchema = z
  .strictObject({
    cpu: z.number().min(0.1).max(64).default(2),
    diskMb: z.int().min(64).default(10_240),
    memoryMb: z.int().min(64).default(2048),
  })
  .prefault({});

const sandboxSchema = z
  .strictObject({
    /** Provider for new sandboxes; `none` turns sandboxes off. */
    default: z
      .union([sandboxProviderSchema, z.literal("none")])
      .default("just-bash"),
    docker: z
      .strictObject({
        limits: sandboxLimitsSchema,
        /** Outbound network from containers. */
        network: z.boolean().default(true),
        runnerUrl: z.url(),
        /** `runsc` (gVisor) where the host has it; the runner warns and falls back otherwise (D7). */
        runtime: z.enum(["runsc", "runc"]).default("runsc"),
        /** Shared secret for the runner's internal API. */
        token: secret.optional(),
      })
      .optional(),
    e2b: apiKeyBlock.optional(),
    microsandbox: z.strictObject({ url: z.url() }).optional(),
    vercel: z
      .strictObject({
        projectId: z.string().optional(),
        teamId: z.string().optional(),
        token: secret.optional(),
      })
      .optional(),
  })
  .prefault({})
  .superRefine((sandbox, context) => {
    const needsBlock = ["docker", "e2b", "vercel", "microsandbox"] as const;
    for (const provider of needsBlock) {
      if (sandbox.default === provider && !sandbox[provider]) {
        context.addIssue({
          code: "custom",
          message: `\`default: ${provider}\` needs a \`${provider}:\` block`,
          path: [provider],
        });
      }
    }
    if (sandbox.default === "local") {
      context.addIssue({
        code: "custom",
        message: "`local` sandboxes exist only in the desktop app",
        path: ["default"],
      });
    }
  });

const storageSchema = z
  .discriminatedUnion("driver", [
    z.strictObject({
      driver: z.literal("local"),
      /**
       * Inside `./.data` beside the embedded database, which git ignores. The
       * Docker image links `./.data` into its data volume, so it persists there too.
       */
      path: z.string().min(1).default("./.data/files"),
    }),
    z.strictObject({
      accessKeyId: secret.optional(),
      bucket: z.string().min(1),
      driver: z.literal("s3"),
      endpoint: z.url().optional(),
      forcePathStyle: z.boolean().default(false),
      region: z.string().min(1).default("auto"),
      secretAccessKey: secret.optional(),
    }),
  ])
  .default({ driver: "local", path: "./.data/files" });

const embeddingsSchema = z
  .strictObject({
    /** Changing the dimension needs a re-index; recorded per chunk. */
    dimensions: z.int().min(1).max(16_000).optional(),
    /** `null` turns RAG indexing off: files still upload, `file_search` is unavailable. */
    model: modelRefSchema.nullable().default(null),
  })
  .prefault({});

/**
 * The icon set is compiled in (D19): `icons:select` in packages/icons reads
 * this block at build time, so a change needs a rebuild, not a restart.
 * Exported for that script, which parses just this block.
 */
export const iconsSchema = z
  .strictObject({
    /** Material only: the filled variants. */
    fill: z.boolean().default(false),
    // Mirrors `iconSetIds` in packages/icons (a test keeps them equal).
    set: z
      .enum(["lucide", "phosphor", "tabler", "hugeicons", "material"])
      .default("lucide"),
    /** Material only; unset means `outlined`. */
    style: z.enum(["outlined", "rounded", "sharp"]).optional(),
    /** Material only; unset means 400. */
    weight: z.literal([100, 200, 300, 400, 500, 600, 700]).optional(),
  })
  .prefault({});

export type IconsConfig = z.infer<typeof iconsSchema>;

/**
 * The interface fonts (apps/web/lib/font-catalog.ts). Compiled in like the
 * icon set: `fonts:select` in apps/web reads this block at build time (and on
 * every `bun dev`), so only the chosen fonts ship and a change needs a
 * rebuild. `FONT_SANS` and `FONT_MONO` override it (Docker build args).
 * Scripts outside Latin fall back to system fonts for every choice but Geist.
 */
export const fontsSchema = z
  .strictObject({
    mono: z.enum(["geist-mono", "jetbrains-mono"]).default("geist-mono"),
    sans: z
      .enum([
        "geist",
        "inter",
        "open-sans",
        "ibm-plex-sans",
        "figtree",
        "manrope",
      ])
      .default("geist"),
  })
  .prefault({});

export type FontsConfig = z.infer<typeof fontsSchema>;

const observabilitySchema = z
  .strictObject({
    /** OpenTelemetry export of AI SDK traces (D21). Off (`null`) by default. */
    otlp: z
      .strictObject({
        endpoint: z.url(),
        headers: z.record(z.string(), z.string()).default({}),
      })
      .nullable()
      .default(null),
    /**
     * Put prompts and outputs on spans (Q28). Off: they're user data and
     * belong in Postgres under our permissions; turn it on only for a
     * developer's own instance.
     */
    recordContent: z.boolean().default(false),
    serviceName: z.string().min(1).default("web"),
  })
  .prefault({});

const budgetDefaultSchema = z.strictObject({
  hard: z.boolean().default(true),
  /** Micro-USD (1 USD = 1_000_000). */
  limitMicros: z.int().min(0),
  period: z.enum(["day", "week", "month"]),
});

const limitsSchema = z
  .strictObject({
    /**
     * Model calls one turn may make before the agent loop is stopped: each
     * round of tool calls is a step. A resumed turn (after an approval)
     * starts counting again.
     */
    agentMaxSteps: z.int().min(1).max(200).default(20),
    /** Defaults for principals without their own budget row. */
    budgets: z
      .strictObject({
        org: budgetDefaultSchema.optional(),
        team: budgetDefaultSchema.optional(),
        user: budgetDefaultSchema.optional(),
      })
      .prefault({}),
    maxConcurrentRunsPerUser: z.int().min(1).default(4),
    memoryMaxChars: z.int().min(500).default(8000),
    requestsPerMinute: z.int().min(1).default(60),
    runTimeoutSeconds: z.int().min(10).default(600),
    uploadMaxMb: z.number().positive().max(10_240).default(25),
  })
  .prefault({});

type FeatureFlag = z.infer<typeof featureFlagSchema>;

const featureDefaults: Record<FeatureFlag, boolean> = {
  fileUploads: true,
  importers: true,
  memory: true,
  // Public links expose content to anyone with the URL; opt in (D13).
  publicLinks: false,
  sandboxes: true,
  webSearch: true,
};

/** Each public flag, optional: unset ones take `featureDefaults`. */
const publicFlagShape = Object.fromEntries(
  featureFlagSchema.options.map((flag) => [flag, z.boolean().optional()])
) as Record<FeatureFlag, z.ZodOptional<z.ZodBoolean>>;

const featuresSchema = z
  .strictObject({
    ...publicFlagShape,
    /**
     * Source chips show the site's favicon and a preview card, fetched by
     * the server (101). Off: chips show the host, and nothing is fetched.
     * Server-side only, so it isn't one of the public feature flags.
     */
    linkPreviews: z.boolean().default(true),
  })
  .prefault({})
  .transform(({ linkPreviews, ...flags }) => {
    const set = Object.fromEntries(
      Object.entries(flags).filter(([, value]) => value !== undefined)
    ) as Partial<Record<FeatureFlag, boolean>>;
    return { ...featureDefaults, ...set, linkPreviews };
  });

const mcpSchema = z
  .strictObject({
    /** Instance-wide MCP servers every agent can use (D18). */
    servers: z
      .array(
        z.strictObject({
          headers: z.record(z.string(), z.string()).default({}),
          name: z.string().regex(/^[a-z][a-z0-9-]*$/, "a lowercase name"),
          transport: z.enum(["http", "sse"]).default("http"),
          url: z.url(),
        })
      )
      .default([]),
  })
  .prefault({});

/**
 * The Site kind (125): whether sites are offered, and the public origins
 * they may load fonts, styles, scripts and images from. The site's CSP blocks everything else.
 * Admins edit it here; it applies on restart.
 */
const siteKindSchema = z
  .strictObject({
    allowedOrigins: z
      .array(
        z
          .string()
          .refine(
            isSiteOrigin,
            "an https origin with no path, like https://fonts.googleapis.com (https://*.example.com covers its subdomains)"
          )
      )
      .max(50)
      .default([...DEFAULT_SITE_ORIGINS])
      .transform((origins) => [...new Set(origins)]),
    enabled: z.boolean().default(true),
    /**
     * Deprecated and ignored (163): sites have no stacks now (pages are TSX
     * on `@workspace/site-ui`, or HTML). Still accepted, since the object
     * is strict and configs written for 125 set it.
     */
    stack: z.string().max(64).optional(),
  })
  .prefault({});

const artifactsSchema = z
  .strictObject({
    /** Per-kind settings (the framework's instance layer), today sites. */
    kinds: z.strictObject({ site: siteKindSchema }).prefault({}),
    /** Separate origin for artifacts and previews (D24); `null` serves them sandboxed from a data origin. */
    origin: z.url().nullable().default(null),
  })
  .prefault({});

export const appConfigSchema = z
  .strictObject({
    artifacts: artifactsSchema,
    auth: authSchema,
    brand: brandSchema,
    decider: deciderSchema,
    embeddings: embeddingsSchema,
    features: featuresSchema,
    fonts: fontsSchema,
    icons: iconsSchema,
    limits: limitsSchema,
    mcp: mcpSchema,
    models: modelsSchema,
    observability: observabilitySchema,
    policies: instancePolicySchema.prefault({}),
    providers: providersSchema,
    sandbox: sandboxSchema,
    search: searchSchema,
    storage: storageSchema,
    version: z.literal(1).default(1),
  })
  .superRefine((config, context) => {
    // Every model reference must point at a configured provider or an alias,
    // so a typo fails at boot rather than on the first chat. zod runs this
    // only once the sections themselves are valid, so these problems show
    // up on the boot after the structural ones are fixed.
    const checkSelector = (
      selector: string | null,
      path: (string | number)[]
    ) => {
      if (selector === null || selector === AUTO_MODEL) {
        return;
      }
      const ref = parseModelRef(selector);
      if (ref) {
        if (!config.providers[ref.provider]) {
          context.addIssue({
            code: "custom",
            message: `provider "${ref.provider}" isn't configured under \`providers\``,
            path,
          });
        }
      } else if (!config.models.aliases[selector]) {
        context.addIssue({
          code: "custom",
          message: `"${selector}" is neither a \`provider:model\` ref nor an alias in \`models.aliases\``,
          path,
        });
      }
    };
    for (const [alias, ref] of Object.entries(config.models.aliases)) {
      checkSelector(ref, ["models", "aliases", alias]);
    }
    // A price under a misspelt ref would leave the real model unpriced, silently.
    for (const ref of Object.keys(config.models.prices)) {
      checkSelector(ref, ["models", "prices", ref]);
    }
    for (const selector of Object.keys(config.models.descriptions)) {
      if (selector === AUTO_MODEL) {
        context.addIssue({
          code: "custom",
          message:
            "`auto`'s description is built in; describe its models instead",
          path: ["models", "descriptions", selector],
        });
      } else {
        checkSelector(selector, ["models", "descriptions", selector]);
      }
    }
    for (const selector of Object.keys(config.models.ratings)) {
      if (selector === AUTO_MODEL) {
        context.addIssue({
          code: "custom",
          message: "`auto` picks a model per message; rate its models instead",
          path: ["models", "ratings", selector],
        });
      } else {
        checkSelector(selector, ["models", "ratings", selector]);
      }
    }
    checkSelector(config.models.default, ["models", "default"]);
    checkSelector(config.models.auto.cheap, ["models", "auto", "cheap"]);
    checkSelector(config.models.auto.strong, ["models", "auto", "strong"]);
    if (config.models.conversationTitleModel !== false) {
      checkSelector(config.models.conversationTitleModel, [
        "models",
        "conversationTitleModel",
      ]);
    }
    checkSelector(config.models.image.default, ["models", "image", "default"]);
    for (const [index, ref] of config.models.image.models.entries()) {
      checkSelector(ref, ["models", "image", "models", index]);
    }
    checkSelector(config.decider.model, ["decider", "model"]);
    checkSelector(config.embeddings.model, ["embeddings", "model"]);
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
/** What the YAML may contain, before defaults. */
export type AppConfigInput = z.input<typeof appConfigSchema>;
