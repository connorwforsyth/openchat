import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { useCallback, useEffect, useMemo } from "react";

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
  type ModelVariant,
  type ThinkingLevel,
  targetForChoice,
  thinkingLevels,
  type VariantChoice,
  type VariantTarget,
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

const NO_VARIANT: ModelVariant = {};

const sameVariant = (a: ModelVariant, b: ModelVariant): boolean =>
  (a.fast ?? false) === (b.fast ?? false) && a.reasoning === b.reasoning;

const sameModel = (a: RunTarget, b: RunTarget | undefined): boolean =>
  a.type === "model" && b?.type === "model" && a.model === b.model;

/**
 * The chosen model's thinking level and fast mode (105). The target says
 * which entry runs (a folded `-high` or `-fast` one); the run options the
 * host sends (`variant`) carry a provider level and fast tier. Both are
 * remembered per model and per person. The remembered choice wins while it
 * still makes the current target and options: it keeps a level fast mode
 * set aside, so turning fast mode off brings it back.
 */
export const useModelVariants = ({
  models,
  onTargetChange,
  onVariantChange,
  recentsKey,
  target,
  variant = NO_VARIANT,
}: {
  readonly models: readonly ModelOption[];
  readonly onTargetChange: ((target: RunTarget) => void) | undefined;
  /** Left out when the host doesn't send run options. */
  readonly onVariantChange: ((variant: ModelVariant) => void) | undefined;
  readonly recentsKey: string | undefined;
  readonly target: RunTarget | undefined;
  readonly variant: ModelVariant | undefined;
}): ModelVariants => {
  const folded = useMemo(() => foldModelVariants(models), [models]);
  const [remembered, remember] = useVariantChoices(recentsKey);
  const sends = onVariantChange !== undefined;
  const family = target ? familyOf(folded, target) : undefined;
  const vendor = family ? modelVendor(family.base) : "";

  const resolve = useCallback(
    (to: ModelFamily, wanted: VariantChoice) =>
      targetForChoice(to, modelVendor(to.base), wanted, sends),
    [sends]
  );

  const kept = family ? remembered.get(family.base.selector) : undefined;
  const choice = useMemo((): VariantChoice => {
    if (!(family && target)) {
      return DEFAULT_CHOICE;
    }
    const wanted = kept ? resolve(family, kept) : undefined;
    return kept &&
      wanted &&
      sameModel(wanted.target, target) &&
      sameVariant(wanted.variant, variant)
      ? kept
      : choiceOfTarget(family, target, variant);
  }, [family, kept, resolve, target, variant]);

  // A model chosen elsewhere (the palette, a reload) gets its remembered
  // level and fast tier back, as long as that doesn't change the target.
  // Once per model and remembered choice: not on every option change, or a
  // level picked a moment ago would be put back.
  const base = family?.base.selector;
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    if (!(family && kept && onVariantChange)) {
      return;
    }
    const wanted = resolve(family, kept);
    if (
      sameModel(wanted.target, target) &&
      !sameVariant(wanted.variant, variant)
    ) {
      onVariantChange(wanted.variant);
    }
  }, [base, kept]);

  const levels = family
    ? thinkingLevels(family, vendor, choice.fast, sends)
    : undefined;
  const shown =
    levels?.find((each) => each.level === choice.level && !each.blocked)
      ?.level ??
    levels?.[0]?.level ??
    "default";

  const emit = useCallback(
    (next: VariantTarget, current: RunTarget | undefined) => {
      if (!sameModel(next.target, current)) {
        onTargetChange?.(next.target);
      }
      onVariantChange?.(next.variant);
    },
    [onTargetChange, onVariantChange]
  );

  const apply = useCallback(
    (next: VariantChoice) => {
      if (!(family && onTargetChange)) {
        return;
      }
      remember(family.base.selector, next);
      emit(resolve(family, next), target);
    },
    [emit, family, onTargetChange, remember, resolve, target]
  );

  const pickTarget = useCallback(
    (picked: RunTarget) => {
      const to = familyOf(folded, picked);
      const last = to ? remembered.get(to.base.selector) : undefined;
      if (to && last) {
        emit(resolve(to, last), undefined);
      } else {
        // An agent, or a model with nothing remembered: its defaults.
        onTargetChange?.(picked);
        onVariantChange?.(NO_VARIANT);
      }
    },
    [emit, folded, onTargetChange, onVariantChange, remembered, resolve]
  );

  const setLevel = useCallback(
    (level: ThinkingLevel) => apply({ ...choice, level }),
    [apply, choice]
  );
  const setFast = useCallback(
    (on: boolean) => apply({ ...choice, fast: on }),
    [apply, choice]
  );

  const fast = family ? fastMode(family, vendor, sends) : undefined;
  return {
    ...(fast ? { fast: { ...fast, on: choice.fast && !fast.blocked } } : {}),
    level: shown,
    ...(levels ? { levels } : {}),
    pickTarget,
    setFast,
    setLevel,
  };
};
