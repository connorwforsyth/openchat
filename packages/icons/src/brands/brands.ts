// Who makes a model, as people know them, and the mark that stands for them.
// The one list of vendors: the picker's group names and row logos both read
// it. Keys are vendor ids as model refs spell them (`anthropic`, or the part
// before `/` behind an aggregator: `gateway:meta/llama-4` is `meta`,
// OpenRouter's `meta-llama/…` is `meta-llama`). Cosmetic only: grouping and
// routing never depend on it (D3), and an id it doesn't list shows as written
// with a letter mark.
//
// `mark` names a monochrome icon in @lobehub/icons-static-svg (`icons/<mark>.svg`).
// After changing a mark, run `bun run icons:generate` in packages/icons.

export interface Brand {
  /** The lobe-icons file name, without `.svg`; unset draws the letter mark. */
  readonly mark?: string;
  readonly name: string;
}

export const brands = {
  alibaba: { mark: "alibaba", name: "Alibaba" },
  amazon: { mark: "aws", name: "Amazon" },
  anthropic: { mark: "anthropic", name: "Anthropic" },
  azure: { mark: "azure", name: "Azure" },
  bedrock: { mark: "bedrock", name: "Bedrock" },
  cohere: { mark: "cohere", name: "Cohere" },
  deepseek: { mark: "deepseek", name: "DeepSeek" },
  fireworks: { mark: "fireworks", name: "Fireworks" },
  gateway: { mark: "vercel", name: "Gateway" },
  google: { mark: "gemini", name: "Google" },
  groq: { mark: "groq", name: "Groq" },
  huggingface: { mark: "huggingface", name: "Hugging Face" },
  meta: { mark: "meta", name: "Meta" },
  "meta-llama": { mark: "meta", name: "Meta" },
  microsoft: { mark: "microsoft", name: "Microsoft" },
  mistral: { mark: "mistral", name: "Mistral" },
  mistralai: { mark: "mistral", name: "Mistral" },
  moonshot: { mark: "moonshot", name: "Moonshot AI" },
  moonshotai: { mark: "moonshot", name: "Moonshot AI" },
  nvidia: { mark: "nvidia", name: "NVIDIA" },
  ollama: { mark: "ollama", name: "Ollama" },
  openai: { mark: "openai", name: "OpenAI" },
  openrouter: { mark: "openrouter", name: "OpenRouter" },
  perplexity: { mark: "perplexity", name: "Perplexity" },
  qwen: { mark: "qwen", name: "Qwen" },
  together: { mark: "together", name: "Together AI" },
  togetherai: { mark: "together", name: "Together AI" },
  vercel: { mark: "vercel", name: "Vercel" },
  "x-ai": { mark: "xai", name: "xAI" },
  xai: { mark: "xai", name: "xAI" },
  "z-ai": { mark: "zai", name: "Z.ai" },
  zai: { mark: "zai", name: "Z.ai" },
  zhipu: { mark: "zhipu", name: "Zhipu AI" },
  zhipuai: { mark: "zhipu", name: "Zhipu AI" },
} as const satisfies Readonly<Record<string, Brand>>;

export type BrandId = keyof typeof brands;

const lookup: Readonly<Record<string, Brand | undefined>> = brands;

/** The brand a vendor id names, if the list has it. */
export const brandOf = (id: string): Brand | undefined =>
  Object.hasOwn(lookup, id) ? lookup[id] : undefined;

/** Every mark the list uses, once, sorted: what `icons:generate` copies. */
export const brandMarkNames = (): readonly string[] =>
  [
    ...new Set(
      Object.values(lookup).flatMap((brand) =>
        brand?.mark === undefined ? [] : [brand.mark]
      )
    ),
  ].sort();
