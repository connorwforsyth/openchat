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
  headers: z.record(z.string(), z.string()).default({}),
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
    /** The model new chats start with; `null` picks the first available. */
    default: modelSelectorSchema.nullable().default(null),
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
      /** Inside `./.data` beside the embedded database, which git ignores. */
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

const featureDefaults: Record<z.infer<typeof featureFlagSchema>, boolean> = {
  fileUploads: true,
  importers: true,
  memory: true,
  // Public links expose content to anyone with the URL; opt in (D13).
  publicLinks: false,
  sandboxes: true,
  webSearch: true,
};

const featuresSchema = z
  .partialRecord(featureFlagSchema, z.boolean())
  .default({})
  .transform((features) => ({ ...featureDefaults, ...features }));

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

const artifactsSchema = z
  .strictObject({
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
    checkSelector(config.models.default, ["models", "default"]);
    checkSelector(config.models.auto.cheap, ["models", "auto", "cheap"]);
    checkSelector(config.models.auto.strong, ["models", "auto", "strong"]);
    checkSelector(config.decider.model, ["decider", "model"]);
    checkSelector(config.embeddings.model, ["embeddings", "model"]);
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
/** What the YAML may contain, before defaults. */
export type AppConfigInput = z.input<typeof appConfigSchema>;
