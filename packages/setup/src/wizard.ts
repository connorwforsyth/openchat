import { parseModelRef } from "@workspace/contract/schemas/models";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  type Answers,
  answersSchema,
  compatibleKeyVariable,
  compatibleSchema,
  type Defaults,
  keyVariables,
  type NativeProvider,
  nativeProviders,
  OLLAMA_URL,
  OLLAMA_URL_FROM_DOCKER,
  type ProviderChoice,
  suggestedModels,
} from "./answers";
import { CANCELLED, type Cancelled, type Prompter } from "./prompter";

// The questions, in order, each defaulting to what the files say now. Pure
// apart from the Prompter it's given; the answers go to `plan.ts`.

const providerLabels: Record<ProviderChoice, string> = {
  anthropic: "Anthropic",
  compatible: "OpenAI-compatible server (Ollama, vLLM, LM Studio, a gateway)",
  openai: "OpenAI",
};

const DOMAIN = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const WHITESPACE = /\s/;

// Ctrl-C is thrown by `ask` and caught once in `runWizard`, so each step
// reads straight through instead of checking after every prompt.
const isCancel = (error: unknown): boolean =>
  error instanceof Error && error.cause === CANCELLED;

const ask = async <T>(pending: Promise<T | Cancelled>): Promise<T> => {
  const value = await pending;
  if (value === CANCELLED) {
    throw new Error("cancelled", { cause: CANCELLED });
  }
  return value as T;
};

const noWhitespace = (value: string): string | undefined =>
  WHITESPACE.test(value) ? "keys don't contain spaces" : undefined;

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const askKey = async (
  prompter: Prompter,
  id: string,
  label: string,
  variable: string,
  defaults: Defaults,
  optional: boolean
): Promise<[string, string][]> => {
  const saved = defaults.keysSet.includes(variable);
  let hint = "Enter to skip; add it to .env later";
  if (saved) {
    hint = "saved in .env; Enter keeps it";
  } else if (optional) {
    hint = "Enter for none";
  }
  const value = await ask(
    prompter.secret({
      id,
      message: `${label} API key (${hint})`,
      validate: noWhitespace,
    })
  );
  return value ? [[variable, value]] : [];
};

const askCompatible = async (
  prompter: Prompter,
  defaults: Defaults,
  mode: Answers["mode"]
) => {
  const fallbackURL = mode === "docker" ? OLLAMA_URL_FROM_DOCKER : OLLAMA_URL;
  const id = await ask(
    prompter.text({
      id: "compatible.id",
      initial: defaults.compatible?.id ?? "ollama",
      message:
        "A short name for it (used in model names, like ollama:llama3.2)",
      validate: (value) =>
        compatibleSchema.shape.id.safeParse(value).error?.issues[0]?.message,
    })
  );
  // A localhost URL means the container itself once the app runs in Docker.
  let initialURL = defaults.compatible?.baseURL ?? fallbackURL;
  if (mode === "docker" && initialURL === OLLAMA_URL) {
    initialURL = OLLAMA_URL_FROM_DOCKER;
  } else if (mode === "local" && initialURL === OLLAMA_URL_FROM_DOCKER) {
    initialURL = OLLAMA_URL;
  }
  const baseURL = await ask(
    prompter.text({
      id: "compatible.url",
      initial: initialURL,
      message:
        mode === "docker"
          ? "Its base URL, as the web container sees it (host.docker.internal is this machine)"
          : "Its base URL",
      validate: (value) =>
        URL.canParse(value)
          ? undefined
          : "a URL, like http://localhost:11434/v1",
    })
  );
  return { baseURL, id };
};

const askModel = async (
  prompter: Prompter,
  which: "fast" | "strong",
  current: string | null,
  providerIds: readonly string[]
): Promise<string | null> => {
  const native = nativeProviders.find((provider) =>
    providerIds.includes(provider)
  );
  const stillValid =
    current !== null &&
    providerIds.includes(parseModelRef(current)?.provider ?? "");
  let suggestion = "";
  if (stillValid) {
    suggestion = current;
  } else if (native) {
    suggestion = suggestedModels[native][which];
  }
  const value = await ask(
    prompter.text({
      id: `model.${which}`,
      initial: suggestion,
      message:
        which === "strong"
          ? "Default model, as provider:model (empty: the first one available)"
          : "Fast model, for titles and routing (empty: none)",
      validate: (input) => {
        if (input.trim() === "") {
          return;
        }
        const ref = parseModelRef(input.trim());
        if (!ref) {
          return "provider:model, like anthropic:claude-haiku-4-5";
        }
        return providerIds.includes(ref.provider)
          ? undefined
          : `"${ref.provider}" isn't one of the providers you picked (${providerIds.join(", ") || "none"})`;
      },
    })
  );
  return value.trim() || null;
};

const askRunAndModels = async (prompter: Prompter, defaults: Defaults) => {
  const mode = await ask(
    prompter.select<Answers["mode"]>({
      id: "mode",
      initial: defaults.mode,
      message: "How do you want to run it?",
      options: [
        {
          hint: "the whole app in containers; needs Docker",
          label: "Docker (compose)",
          value: "docker",
        },
        {
          hint: "bun dev on this machine, for working on the code",
          label: "Local development",
          value: "local",
        },
      ],
    })
  );
  const database =
    mode === "local"
      ? await ask(
          prompter.select<Answers["database"]>({
            id: "database",
            initial: defaults.database,
            message: "Which database?",
            options: [
              {
                hint: "compose starts it; needs Docker",
                label: "Postgres",
                value: "postgres",
              },
              {
                hint: "embedded in ./.data, nothing to run; one process only",
                label: "PGlite",
                value: "pglite",
              },
            ],
          })
        )
      : defaults.database;

  const providers = await ask(
    prompter.multiselect<ProviderChoice>({
      id: "providers",
      initial: defaults.providers,
      message:
        "Which model providers? (space to toggle; none means a local Ollama if one is running)",
      options: (["anthropic", "openai", "compatible"] as const).map(
        (value) => ({ label: providerLabels[value], value })
      ),
    })
  );

  const keys: [string, string][] = [];
  for (const provider of nativeProviders) {
    if (providers.includes(provider)) {
      keys.push(
        // biome-ignore lint/performance/noAwaitInLoops: one question at a time, in order.
        ...(await askKey(
          prompter,
          `key.${provider}`,
          providerLabels[provider as NativeProvider],
          keyVariables[provider],
          defaults,
          false
        ))
      );
    }
  }
  let compatible: Answers["compatible"] = null;
  if (providers.includes("compatible")) {
    compatible = await askCompatible(prompter, defaults, mode);
    keys.push(
      ...(await askKey(
        prompter,
        "key.compatible",
        compatible.id,
        compatibleKeyVariable(compatible.id),
        defaults,
        true
      ))
    );
  }

  const providerIds = [
    ...nativeProviders.filter((provider) => providers.includes(provider)),
    ...(compatible ? [compatible.id] : []),
  ];
  let strongModel: string | null = null;
  let fastModel: string | null = null;
  if (providerIds.length > 0) {
    strongModel = await askModel(
      prompter,
      "strong",
      defaults.strongModel,
      providerIds
    );
    fastModel = await askModel(
      prompter,
      "fast",
      defaults.fastModel,
      providerIds
    );
  } else {
    prompter.info(
      "No providers: the app will look for Ollama on localhost:11434. Run this again to add one."
    );
  }

  return {
    compatible,
    database,
    fastModel,
    keys: Object.fromEntries(keys),
    mode,
    providers,
    strongModel,
  };
};

const askAccess = async (prompter: Prompter, defaults: Defaults) => {
  const signup = await ask(
    prompter.select<Answers["signup"]>({
      id: "signup",
      initial: defaults.signup,
      message: "Who can sign up? (the first account is always the admin)",
      options: [
        {
          hint: "admins invite people",
          label: "By invitation",
          value: "invite",
        },
        { hint: "anyone who can reach it", label: "Anyone", value: "open" },
        {
          hint: "email addresses at your domains",
          label: "By email domain",
          value: "domain",
        },
        ...(defaults.signup === "sso"
          ? [
              {
                hint: "as configured",
                label: "Single sign-on",
                value: "sso" as const,
              },
            ]
          : []),
      ],
    })
  );
  const domains =
    signup === "domain"
      ? splitList(
          await ask(
            prompter.text({
              id: "domains",
              initial: defaults.domains.join(", "),
              message: "Which email domains? (comma-separated)",
              validate: (value) => {
                const list = splitList(value);
                if (list.length === 0) {
                  return "at least one domain, like example.com";
                }
                const bad = list.find((domain) => !DOMAIN.test(domain));
                return bad ? `"${bad}" isn't a domain` : undefined;
              },
            })
          )
        )
      : defaults.domains;
  const brandName = await ask(
    prompter.text({
      id: "brandName",
      initial: defaults.brandName,
      message: "What should the app be called?",
      validate: (value) => {
        const { length } = value.trim();
        return length > 0 && length <= 60 ? undefined : "1 to 60 characters";
      },
    })
  );
  return { brandName: brandName.trim(), domains, signup };
};

const askSandbox = async (prompter: Prompter, defaults: Defaults) => {
  const sandbox = await ask(
    prompter.select<Answers["sandbox"]>({
      id: "sandbox",
      initial: defaults.sandbox,
      message: "Sandboxes, where agents run commands",
      options: [
        {
          hint: "simulated bash in memory; safe anywhere, no real installs",
          label: "just-bash",
          value: "just-bash",
        },
        {
          hint: "real containers: installs, dev servers, previews",
          label: "Docker",
          value: "docker",
        },
        { hint: "no sandbox tools", label: "None", value: "none" },
      ],
    })
  );
  const egress =
    sandbox === "docker"
      ? await ask(
          prompter.select<Answers["egress"]>({
            id: "egress",
            initial: defaults.egress,
            message: "Can sandboxes reach the network?",
            options: [
              {
                hint: "safest; package installs fail",
                label: "No",
                value: "none",
              },
              {
                hint: "anywhere, your local network included; needed for npm install",
                label: "Yes",
                value: "open",
              },
            ],
          })
        )
      : defaults.egress;
  return { egress, sandbox };
};

const askExtras = async (prompter: Prompter, defaults: Defaults) => {
  const services = await ask(
    prompter.multiselect<"search" | "artifacts">({
      id: "services",
      initial: [
        ...(defaults.search ? (["search"] as const) : []),
        ...(defaults.artifacts ? (["artifacts"] as const) : []),
      ],
      message: "Optional services",
      options: [
        {
          hint: "SearXNG, for the web_search tool",
          label: "Web search",
          value: "search",
        },
        {
          hint: "React and Mermaid previews on their own origin",
          label: "Artifact previews",
          value: "artifacts",
        },
      ],
    })
  );
  const set = await ask(
    prompter.select<Answers["icons"]["set"]>({
      id: "icons",
      initial: defaults.icons.set,
      message: "Icon set (compiled in, so a change means a rebuild)",
      options: [
        { label: "Lucide", value: "lucide" },
        { label: "Phosphor", value: "phosphor" },
        { label: "Material Symbols", value: "material" },
      ],
    })
  );
  const style =
    set === "material"
      ? await ask(
          prompter.select<NonNullable<Answers["icons"]["style"]>>({
            id: "iconStyle",
            initial: defaults.icons.style ?? "outlined",
            message: "Material style",
            options: [
              { label: "Outlined", value: "outlined" },
              { label: "Rounded", value: "rounded" },
              { label: "Sharp", value: "sharp" },
            ],
          })
        )
      : null;
  return {
    artifacts: services.includes("artifacts"),
    icons: { set, style },
    search: services.includes("search"),
  };
};

export interface WizardError {
  readonly type: "cancelled";
}

/** Asks everything; `cancelled` when the person presses Ctrl-C (nothing is written). */
export const runWizard = async (
  prompter: Prompter,
  defaults: Defaults
): Promise<Result<Answers, WizardError>> => {
  try {
    const models = await askRunAndModels(prompter, defaults);
    const access = await askAccess(prompter, defaults);
    const sandbox = await askSandbox(prompter, defaults);
    const extras = await askExtras(prompter, defaults);
    return ok(
      answersSchema.parse({ ...models, ...access, ...sandbox, ...extras })
    );
  } catch (error) {
    if (isCancel(error)) {
      return err({ type: "cancelled" });
    }
    throw error;
  }
};
