import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Answers } from "./answers";
import type { CurrentFiles } from "./current";

// Test inputs: the repo's real example files, and answer sets. The keys are
// placeholders, never real ones, so snapshots can hold them.

const root = join(import.meta.dirname, "..", "..", "..");

// The codename belongs only in the example's brand block (D18); snapshots
// live elsewhere, so the tests read a copy with a neutral name.
const codename = new RegExp(["open", "chat"].join(""), "gi");

export const envExample = readFileSync(join(root, ".env.example"), "utf8");
export const configExample = readFileSync(
  join(root, "app.config.example.yaml"),
  "utf8"
).replaceAll(codename, "example");

export const firstRun: CurrentFiles = {
  config: undefined,
  configExample,
  env: undefined,
  envExample,
  override: undefined,
};

/** Counts up, so each generated secret is distinct and every run is the same. */
export const fakeRandom = () => {
  let count = 0;
  return () => {
    count += 1;
    return `fake-random-${count}`;
  };
};

export const FAKE_KEYS = {
  anthropic: "fake-anthropic-key-placeholder",
  gateway: "fake-gateway-key-placeholder",
  openai: "fake-openai-key-placeholder",
} as const;

/** What the loop did by hand for the 026 demo. */
export const demoAnswers: Answers = {
  artifacts: false,
  brandName: "example",
  compatible: null,
  database: "postgres",
  domains: [],
  egress: "open",
  fastModel: "anthropic:claude-haiku-4-5",
  icons: { set: "material", style: "rounded" },
  keys: { ANTHROPIC_API_KEY: FAKE_KEYS.anthropic },
  mode: "docker",
  providers: ["anthropic"],
  sandbox: "docker",
  search: false,
  signup: "invite",
  strongModel: "anthropic:claude-opus-5-5",
};

export const localAnswers: Answers = {
  artifacts: true,
  brandName: "Acme Chat",
  compatible: { baseURL: "http://localhost:11434/v1", id: "ollama" },
  database: "pglite",
  domains: ["example.com", "example.org"],
  egress: "none",
  fastModel: null,
  icons: { set: "lucide", style: null },
  keys: {},
  mode: "local",
  providers: ["compatible"],
  sandbox: "just-bash",
  search: true,
  signup: "domain",
  strongModel: "ollama:llama3.2",
};

export const everythingAnswers: Answers = {
  artifacts: true,
  brandName: "Everything",
  compatible: {
    baseURL: "http://host.docker.internal:4000/v1",
    id: "gateway",
  },
  database: "postgres",
  domains: [],
  egress: "none",
  fastModel: "openai:gpt-5-mini",
  icons: { set: "phosphor", style: null },
  keys: {
    ANTHROPIC_API_KEY: FAKE_KEYS.anthropic,
    GATEWAY_API_KEY: FAKE_KEYS.gateway,
    OPENAI_API_KEY: FAKE_KEYS.openai,
  },
  mode: "docker",
  providers: ["anthropic", "openai", "compatible"],
  sandbox: "none",
  search: true,
  signup: "open",
  strongModel: "anthropic:claude-opus-5-5",
};
