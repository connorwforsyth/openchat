import {
  confirm,
  isCancel,
  log,
  multiselect,
  note,
  password,
  select,
  text,
} from "@clack/prompts";

import {
  CANCELLED,
  type Cancelled,
  type Choice,
  type Prompter,
} from "./prompter";

// The terminal Prompter, on @clack/prompts (MIT). Strings are plain English
// rather than Lingui: this is a developer tool in a terminal, and the
// catalogs and macros are set up for the React apps.

const orCancelled = <T>(value: T): Exclude<T, symbol> | Cancelled =>
  isCancel(value) ? CANCELLED : (value as Exclude<T, symbol>);

interface ChoicePrompt<I, V extends string> {
  readonly initial: I;
  readonly message: string;
  readonly options: readonly Choice<V>[];
}

// clack's option type is conditional on the value type, which a generic V
// can't satisfy until it's instantiated; the shapes are the same.
const toOptions = <V extends string>(options: readonly Choice<V>[]) =>
  options.map((option) => ({ ...option })) as never;

const clackSelect = async <V extends string>({
  initial,
  message,
  options,
}: ChoicePrompt<V, V>): Promise<V | Cancelled> =>
  orCancelled(
    await select<V>({
      initialValue: initial,
      message,
      options: toOptions(options),
    })
  );

const clackMultiselect = async <V extends string>({
  initial,
  message,
  options,
}: ChoicePrompt<readonly V[], V>): Promise<V[] | Cancelled> =>
  orCancelled(
    await multiselect<V>({
      initialValues: [...initial],
      message,
      options: toOptions(options),
      required: false,
    })
  );

export const clackPrompter: Prompter = {
  confirm: async ({ initial, message }) =>
    orCancelled(await confirm({ initialValue: initial, message })),
  info: (message) => log.info(message),
  multiselect: clackMultiselect,
  note: (message, title) => note(message, title),
  // clack masks every character and redraws the answer masked too.
  secret: async ({ message, validate }) =>
    orCancelled(
      await password({
        message,
        validate: validate ? (value) => validate(value ?? "") : undefined,
      })
    ),
  select: clackSelect,
  text: async ({ initial, message, validate }) =>
    orCancelled(
      await text({
        initialValue: initial,
        message,
        validate: validate ? (value) => validate(value ?? "") : undefined,
      })
    ),
  warn: (message) => log.warn(message),
};
