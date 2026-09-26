import type { AppConfig } from "@workspace/config/schema";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import { err, ok, type Result } from "@workspace/shared/result";

import type { DecideOptions, Decider } from "../ports/decider";
import { probabilityOfTrue } from "./questions";

// Auto model routing (D15 use 1, M1): the `auto` model asks the Decider
// whether a turn needs the strong model, and sends it to `models.auto.cheap`
// or `.strong`. Routing isn't a permission path, so with no opinion (the
// Decider is off or failed) the turn goes to the strong model: `auto` should
// never answer worse than picking the strong model by hand.

export const AUTO_ROUTE_QUESTIONS = [
  {
    id: "needsStrongModel",
    prompt:
      "Does answering this turn well need a strong, expensive model (multi-step reasoning, hard code or maths, long careful writing), rather than a fast cheap one (chit-chat, simple facts, short rewrites)?",
    type: "boolean",
  },
] as const;

export interface AutoRoute {
  /** `null` when the Decider had no opinion. */
  readonly probability: number | null;
  readonly routedBy: "decider" | "fallback";
  readonly selector: ModelSelector;
}

export interface AutoRouteInput {
  readonly config: Pick<AppConfig, "decider" | "models">;
  readonly context?: DecideOptions["context"];
  readonly decider: Decider;
  readonly signal?: AbortSignal;
  readonly state: DeciderState;
}

export const routeAutoModel = async ({
  config,
  context,
  decider,
  signal,
  state,
}: AutoRouteInput): Promise<
  Result<AutoRoute, { readonly type: "auto_disabled" }>
> => {
  const { cheap, enabled, strong } = config.models.auto;
  if (!(enabled && cheap && strong)) {
    return err({ type: "auto_disabled" });
  }
  const decided = await decider.decide(state, AUTO_ROUTE_QUESTIONS, {
    context,
    purpose: "auto-route",
    signal,
  });
  if (!decided.ok) {
    return ok({ probability: null, routedBy: "fallback", selector: strong });
  }
  const probability = probabilityOfTrue(decided.value.needsStrongModel);
  return ok({
    probability,
    routedBy: "decider",
    selector:
      probability >= config.decider.thresholds.autoRouteStrong ? strong : cheap,
  });
};
