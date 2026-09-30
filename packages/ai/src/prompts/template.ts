// `{{name}}` placeholders in prompt fragments. The Markdown holds the
// words; the values (a file's path, the memory file) are filled in per turn.

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/**
 * `template` with each `{{name}}` replaced by `values[name]`, in one pass:
 * a value that itself contains `{{…}}` (a mentioned file, say) is left as
 * it is. Throws on a placeholder with no value, which is a bug in the
 * caller or the fragment, caught by the tests that render it. Pure.
 */
export const fillPrompt = (
  template: string,
  values: Readonly<Record<string, string>>
): string =>
  template.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`no value for the prompt placeholder {{${name}}}`);
    }
    return value;
  });
