import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { useCallback, useMemo } from "react";

import { modelVendor } from "../options";
import {
  choiceOfTarget,
  DEFAULT_CHOICE,
  type FastMode,
  familyOf,
  fastMode,
  foldModelVariants,
  type LevelChoice,
  type ModelFamily,
  type ThinkingLevel,
  targetForChoice,
  thinkingLevels,
  type VariantChoice,
} from "../variants";
import { useVariantChoices } from "./use-variant-choices";

export interface ModelVariants {
  /** Fast mode for the chosen model, and whether it's on; `undefined` when it has none. */
  readonly fast?: FastMode & { readonly on: boolean };
  /** The thinking level shown, one of `levels`. */
  readonly level: ThinkingLevel;
  /** `undefined` when the chosen model has no thinking choice. */
  readonly levels?: readonly LevelChoice[];
  /** A model or agent picked in the picker, with that model's last choices. */
  readonly pickTarget: (target: RunTarget) => void;
  readonly setFast: (on: boolean) => void;
  readonly setLevel: (level: ThinkingLevel) => void;
}

const sameTarget = (a: RunTarget, b: RunTarget): boolean =>
  a.type === "model" &&
  b.type === "model" &&
  a.model === b.model &&
  a.parameters?.reasoningEffort === b.parameters?.reasoningEffort;

/**
 * The chosen model's thinking level and fast mode (105), both read from and
 * written to the target itself, and remembered per model and per person.
 * The remembered choice wins while it still makes the current target: it
 * keeps a level fast mode set aside ("High" on a folded `-high` entry), so
 * turning fast mode off brings it back.
 */
export const useModelVariants = ({
  models,
  onTargetChange,
  recentsKey,
  target,
}: {
  readonly models: readonly ModelOption[];
  readonly onTargetChange: ((target: RunTarget) => void) | undefined;
  readonly recentsKey: string | undefined;
  readonly target: RunTarget | undefined;
}): ModelVariants => {
  const folded = useMemo(() => foldModelVariants(models), [models]);
  const [remembered, remember] = useVariantChoices(recentsKey);
  const family = target ? familyOf(folded, target) : undefined;
  const vendor = family ? modelVendor(family.base) : "";

  const choice = useMemo((): VariantChoice => {
    if (!(family && target)) {
      return DEFAULT_CHOICE;
    }
    const kept = remembered.get(family.base.selector);
    return kept && sameTarget(targetForChoice(family, vendor, kept), target)
      ? kept
      : choiceOfTarget(family, target);
  }, [family, remembered, target, vendor]);

  const levels = family
    ? thinkingLevels(family, vendor, choice.fast)
    : undefined;
  const shown =
    levels?.find((each) => each.level === choice.level && !each.blocked)
      ?.level ??
    levels?.[0]?.level ??
    "default";

  const apply = useCallback(
    (next: VariantChoice, to: ModelFamily | undefined = family) => {
      if (!(to && onTargetChange)) {
        return;
      }
      remember(to.base.selector, next);
      onTargetChange(targetForChoice(to, modelVendor(to.base), next));
    },
    [family, onTargetChange, remember]
  );

  const pickTarget = useCallback(
    (picked: RunTarget) => {
      const to = familyOf(folded, picked);
      const kept = to ? remembered.get(to.base.selector) : undefined;
      if (to && kept && onTargetChange) {
        onTargetChange(targetForChoice(to, modelVendor(to.base), kept));
      } else {
        onTargetChange?.(picked);
      }
    },
    [folded, onTargetChange, remembered]
  );

  const setLevel = useCallback(
    (level: ThinkingLevel) => apply({ ...choice, level }),
    [apply, choice]
  );
  const setFast = useCallback(
    (on: boolean) => apply({ ...choice, fast: on }),
    [apply, choice]
  );

  const fast = family ? fastMode(family, vendor) : undefined;
  return {
    ...(fast ? { fast: { ...fast, on: choice.fast && !fast.blocked } } : {}),
    level: shown,
    ...(levels ? { levels } : {}),
    pickTarget,
    setFast,
    setLevel,
  };
};
