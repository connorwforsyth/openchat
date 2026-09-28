import { modelRefSchema } from "@workspace/contract/schemas/models";
import { z } from "zod";

// What the wizard asks, as data. `plan.ts` turns answers into files, and
// `current.ts` reads the files back into answers, so a re-run starts from
// what's already there.

/** Docker runs the whole app in compose; local runs `bun dev` on the host. */
export const runModeSchema = z.enum(["docker", "local"]);
export type RunMode = z.infer<typeof runModeSchema>;

/** Local mode only: compose's Postgres, or the embedded PGlite (no Docker needed). */
export const databaseSchema = z.enum(["postgres", "pglite"]);
export type Database = z.infer<typeof databaseSchema>;

export const nativeProviders = ["anthropic", "openai"] as const;
export type NativeProvider = (typeof nativeProviders)[number];

export const providerChoiceSchema = z.enum([...nativeProviders, "compatible"]);
export type ProviderChoice = z.infer<typeof providerChoiceSchema>;

/** The `.env` variable each native provider's key lives in. */
export const keyVariables = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<NativeProvider, string>;

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** `.env` variable for a compatible provider's (optional) key: `ollama` → `OLLAMA_API_KEY`. */
export const compatibleKeyVariable = (id: string): string =>
  `${id.toUpperCase().replaceAll("-", "_")}_API_KEY`;

/** An OpenAI-compatible server (Ollama, vLLM, LM Studio, a hosted gateway). */
export const compatibleSchema = z.object({
  baseURL: z.url(),
  id: z
    .string()
    .regex(PROVIDER_ID, "lowercase, like `ollama`")
    .refine(
      (id) => !(nativeProviders as readonly string[]).includes(id),
      "that name is taken by a built-in provider"
    ),
});
export type Compatible = z.infer<typeof compatibleSchema>;

/** `sso` is offered only when the file already has it: its providers are set by hand. */
export const signupSchema = z.enum(["open", "invite", "domain", "sso"]);

export const sandboxChoiceSchema = z.enum(["just-bash", "docker", "none"]);
export type SandboxChoice = z.infer<typeof sandboxChoiceSchema>;

/** `allowlist` needs an egress proxy nobody has set up yet, so it isn't offered. */
export const egressSchema = z.enum(["none", "open"]);

export const iconSetSchema = z.enum(["lucide", "phosphor", "material"]);
export const iconStyleSchema = z.enum(["outlined", "rounded", "sharp"]);

export const answersSchema = z.object({
  artifacts: z.boolean(),
  brandName: z.string().trim().min(1).max(60),
  compatible: compatibleSchema.nullable(),
  database: databaseSchema,
  domains: z.array(z.string()),
  egress: egressSchema,
  fastModel: modelRefSchema.nullable(),
  icons: z.object({
    set: iconSetSchema,
    /** Material only. */
    style: iconStyleSchema.nullable(),
  }),
  /**
   * Keys typed this run, by `.env` variable. A provider missing here keeps
   * whatever `.env` already has. These are the only secrets in the answers:
   * they go to `.env` and nowhere else.
   */
  keys: z.record(z.string(), z.string().min(1)),
  mode: runModeSchema,
  providers: z.array(providerChoiceSchema),
  sandbox: sandboxChoiceSchema,
  search: z.boolean(),
  signup: signupSchema,
  strongModel: modelRefSchema.nullable(),
});
export type Answers = z.infer<typeof answersSchema>;

/** Answers minus the typed keys: what a re-run can recover from the files. */
export type Defaults = Omit<Answers, "keys"> & {
  /** Which key variables `.env` already has a value for (never the values). */
  readonly keysSet: readonly string[];
};

/** Suggested models per provider; any `provider:model` the provider serves works. */
export const suggestedModels: Record<
  NativeProvider,
  { readonly fast: string; readonly strong: string }
> = {
  anthropic: {
    fast: "anthropic:claude-haiku-4-5",
    strong: "anthropic:claude-opus-5-5",
  },
  openai: { fast: "openai:gpt-5-mini", strong: "openai:gpt-5" },
};

export const OLLAMA_URL = "http://localhost:11434/v1";
/** How a container reaches a server on the host (compose adds the host entry on Linux). */
export const OLLAMA_URL_FROM_DOCKER = "http://host.docker.internal:11434/v1";
