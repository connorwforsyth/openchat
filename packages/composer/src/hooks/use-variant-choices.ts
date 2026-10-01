import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { type VariantChoice, variantChoiceSchema } from "../variants";

// Each model's thinking level and fast mode (105), remembered per person
// like the picker's recents: in local storage under their scope (the host
// passes the user id), keyed by the model's selector. Storage that's
// missing, full or blocked keeps them in memory for the session.

// Enough for everyone's working set; the oldest choices drop off first.
const LIMIT = 50;

const storedSchema = z.array(z.tuple([z.string().min(1), variantChoiceSchema]));

export type VariantChoices = ReadonlyMap<string, VariantChoice>;

const storageKeyFor = (scope: string | undefined) =>
  `composer:model-variants:${scope ?? "anyone"}`;

const read = (key: string): VariantChoices => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = storedSchema.safeParse(raw ? JSON.parse(raw) : []);
    return new Map(parsed.success ? parsed.data.slice(-LIMIT) : []);
  } catch {
    return new Map();
  }
};

const write = (key: string, choices: VariantChoices): void => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([...choices]));
  } catch {
    // Kept in memory only; the next choice tries again.
  }
};

/** `choices` with `model`'s set to `choice`, newest last, at most `LIMIT`. */
export const rememberChoice = (
  choices: VariantChoices,
  model: string,
  choice: VariantChoice
): VariantChoices =>
  new Map(
    [
      ...[...choices].filter(([each]) => each !== model),
      [model, choice] as const,
    ].slice(-LIMIT)
  );

/** The remembered choices, by model selector, and a way to set one. */
export const useVariantChoices = (
  scope: string | undefined
): readonly [
  VariantChoices,
  (model: string, choice: VariantChoice) => void,
] => {
  const storageKey = storageKeyFor(scope);
  const [choices, setChoices] = useState<VariantChoices>(() => new Map());
  // Read after mounting: the server render has no storage.
  useEffect(() => {
    setChoices(read(storageKey));
  }, [storageKey]);
  const remember = useCallback(
    (model: string, choice: VariantChoice) => {
      setChoices((current) => {
        const next = rememberChoice(current, model, choice);
        write(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );
  return [choices, remember] as const;
};
