import type { AppConfig } from "@workspace/config/schema";
import { parseModelRef } from "@workspace/contract/schemas/models";

import type { ChatKeys } from "../keys/resolve";
import type { Decider } from "../ports/decider";
import type { ProviderRegistry } from "../ports/provider-registry";
import {
  createEvaluationDecider,
  createUnavailableDecider,
  type LogDecision,
} from "./evaluation-decider";
import { languageModelEvaluator } from "./language-model-evaluator";

// The Decider app.config.yaml `decider` asks for, paid for by the chat's keys
// like any other call (D17). Anything missing (the Decider switched off, no
// model configured, no key) gives a Decider with no opinion, so every caller
// falls back to its rules: with an empty env that's the normal case.

export interface CreateDeciderDeps {
  readonly keys: ChatKeys;
  /** Writes `decision_log`; skipped when `decider.logDecisions` is off. */
  readonly logDecision?: LogDecision;
  readonly now?: () => Date;
  readonly registry: ProviderRegistry;
}

export const createDecider = (
  config: Pick<AppConfig, "decider" | "models">,
  { keys, logDecision, now, registry }: CreateDeciderDeps
): Decider => {
  const log = config.decider.logDecisions ? logDecision : undefined;
  const unavailable = (adapter: Decider["adapter"], message: string) =>
    createUnavailableDecider({ adapter, logDecision: log, message, now });

  switch (config.decider.adapter) {
    case "none":
      return unavailable("rules", "the Decider is off");
    case "jev":
      // Hosted only and opt-in; it arrives with a provider that serves it.
      return unavailable(
        "jev",
        "the jev adapter isn't available on this instance"
      );
    case "llm-fallback": {
      const selector =
        config.decider.model ??
        config.models.auto.cheap ??
        config.models.default;
      if (!selector) {
        return unavailable("llm-fallback", "no Decider model is configured");
      }
      const ref = registry.resolve(selector);
      if (!ref.ok) {
        return unavailable(
          "llm-fallback",
          `the Decider model "${selector}" doesn't resolve`
        );
      }
      const provider = parseModelRef(ref.value)?.provider ?? "";
      const model = registry.languageModel(ref.value, keys[provider]);
      if (!model.ok) {
        return unavailable(
          "llm-fallback",
          `no key for the Decider model's provider`
        );
      }
      return createEvaluationDecider({
        adapter: "llm-fallback",
        logDecision: log,
        model: languageModelEvaluator(model.value),
        modelRef: ref.value,
        now,
      });
    }
    default:
      return config.decider.adapter satisfies never;
  }
};
