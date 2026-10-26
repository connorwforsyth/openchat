// How capable a model is, 1 (least) to 5 (most), for the picker's
// Intelligence bar. Curated by hand for the models the instance ships or
// configures by default; there's no keyless public source for it yet.
// Keyed like the Gateway (`creator/model`); a direct provider's model maps
// here by its maker (`anthropic:claude-haiku-5-5` → `anthropic/claude-haiku-5.5`),
// a local one by its provider id (`ollama:qwen2.5:3b` → `ollama/qwen2.5:3b`).
// `models.ratings` in app.config still wins.

export const INTELLIGENCE: Readonly<Record<string, number>> = {
  "anthropic/claude-fable-5": 5,
  "anthropic/claude-fable-5.1": 5,
  "anthropic/claude-haiku-4.5": 2,
  "anthropic/claude-haiku-5.5": 3,
  "anthropic/claude-opus-5": 5,
  "anthropic/claude-opus-5.5": 5,
  "anthropic/claude-sonnet-4.5": 3,
  "anthropic/claude-sonnet-5": 4,
  "anthropic/claude-sonnet-5.5": 4,
  "google/gemini-2.5-flash": 2,
  "google/gemini-2.5-pro": 3,
  "google/gemini-3.5-flash": 3,
  "google/gemini-3.5-flash-lite": 2,
  "ollama/gemma3": 1,
  "ollama/llama3.2": 1,
  "ollama/qwen2.5:3b": 1,
  "ollama/qwen3": 2,
  "openai/gpt-4.1": 2,
  "openai/gpt-4.1-mini": 2,
  "openai/gpt-4o": 2,
  "openai/gpt-4o-mini": 1,
  "openai/gpt-5": 4,
  "openai/gpt-5-mini": 3,
  "openai/gpt-5-nano": 2,
  "openai/gpt-5.5": 5,
  "openai/gpt-oss-20b": 2,
  "openai/gpt-oss-120b": 3,
};
