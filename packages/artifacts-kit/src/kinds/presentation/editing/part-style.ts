// biome-ignore lint/performance/noNamespaceImport: Babel's node predicates read as `t.isX`, the library's own convention.
import * as t from "@babel/types";

/** A splice into the source: `text` replaces `from`..`to`. */
export interface Splice {
  from: number;
  text: string;
  to: number;
}

// Not in open-slide: a slide-ui layout draws its own parts (a Title's
// heading, a Bullets' points), so a person styling one writes the layout's
// `styles` prop, keyed by part:
//
//   <Title styles={{ title: { color: 'var(--primary)' } }} title="Q3" />
//
// Each part is a style object, merged the way `set-style` merges `style`.

export interface PartStyleOp {
  readonly key: string;
  readonly part: string;
  readonly value: string | null;
}

type Entry =
  | {
      readonly kind: "key";
      /** The key as written (`fontSize`, `'font-size'`), kept on rewrite. */
      readonly keyText: string;
      readonly name: string;
      text: string;
    }
  | { readonly kind: "raw"; readonly text: string };

interface Part {
  entries: Entry[];
  /** The part's key as written. */
  readonly keyText: string;
  /** The part's object as written, when it isn't a plain object literal. */
  readonly raw: string | null;
}

// As edit-ops writes a style value, so the two read alike.
const jsString = (value: string): string =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;

const findStylesAttr = (opening: t.JSXOpeningElement): t.JSXAttribute | null =>
  opening.attributes.find(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === "styles"
  ) ?? null;

const keyName = (key: t.Node): string | null => {
  if (t.isIdentifier(key)) {
    return key.name;
  }
  return t.isStringLiteral(key) ? key.value : null;
};

const textOf = (source: string, node: t.Node): string =>
  source.slice(node.start ?? 0, node.end ?? 0);

/** An object literal's entries, keyed where they can be. */
const entriesOf = (source: string, object: t.ObjectExpression): Entry[] =>
  object.properties.map((property): Entry => {
    const name =
      t.isObjectProperty(property) && !property.computed
        ? keyName(property.key)
        : null;
    return name !== null && t.isObjectProperty(property)
      ? {
          keyText: textOf(source, property.key),
          kind: "key",
          name,
          text: textOf(source, property.value),
        }
      : { kind: "raw", text: textOf(source, property) };
  });

const readParts = (
  source: string,
  attr: t.JSXAttribute | null
): Map<string, Part> | { error: string } => {
  const parts = new Map<string, Part>();
  if (!attr) {
    return parts;
  }
  const { value } = attr;
  const expression = t.isJSXExpressionContainer(value)
    ? value.expression
    : null;
  if (!t.isObjectExpression(expression)) {
    return { error: "styles prop has unsupported form" };
  }
  for (const property of expression.properties) {
    const name =
      t.isObjectProperty(property) && !property.computed
        ? keyName(property.key)
        : null;
    if (name === null || !t.isObjectProperty(property)) {
      return { error: "styles prop has unsupported key" };
    }
    const keyText = textOf(source, property.key);
    parts.set(
      name,
      t.isObjectExpression(property.value)
        ? { entries: entriesOf(source, property.value), keyText, raw: null }
        : { entries: [], keyText, raw: textOf(source, property.value) }
    );
  }
  return parts;
};

const writeEntries = (entries: readonly Entry[]): string =>
  entries
    .map((entry) =>
      entry.kind === "key" ? `${entry.keyText}: ${entry.text}` : entry.text
    )
    .join(", ");

const applyOp = (part: Part, op: PartStyleOp): Part => {
  const kept = part.entries.filter(
    (entry) => !(entry.kind === "key" && entry.name === op.key)
  );
  const hasRaw = kept.some((entry) => entry.kind === "raw");
  if (op.value !== null) {
    return {
      ...part,
      entries: [
        ...kept,
        {
          keyText: op.key,
          kind: "key",
          name: op.key,
          text: jsString(op.value),
        },
      ],
    };
  }
  // A spread could still set the key, so clearing it writes `undefined`.
  return {
    ...part,
    entries: hasRaw
      ? [
          ...kept,
          { keyText: op.key, kind: "key", name: op.key, text: "undefined" },
        ]
      : kept,
  };
};

/**
 * The splice that sets each op's `part`/`key` in `element`'s `styles`
 * prop, adding the prop when it's missing and removing it when it's left
 * empty. `null` when there's nothing to change.
 */
export function buildPartStyleSplice(
  source: string,
  element: t.JSXElement,
  ops: readonly PartStyleOp[]
): Splice | { error: string } | null {
  const opening = element.openingElement;
  const attr = findStylesAttr(opening);
  const parts = readParts(source, attr);
  if ("error" in parts) {
    return parts;
  }
  for (const op of ops) {
    const part = parts.get(op.part) ?? {
      entries: [],
      keyText: op.part,
      raw: null,
    };
    if (part.raw !== null) {
      return { error: `styles.${op.part} isn't an object literal` };
    }
    parts.set(op.part, applyOp(part, op));
  }
  const written = [...parts]
    .filter(([, part]) => part.raw !== null || part.entries.length > 0)
    .map(([, part]) =>
      part.raw === null
        ? `${part.keyText}: { ${writeEntries(part.entries)} }`
        : `${part.keyText}: ${part.raw}`
    );
  if (written.length === 0) {
    if (!attr) {
      return null;
    }
    const from =
      (attr.start ?? 0) > 0 && source[(attr.start ?? 0) - 1] === " "
        ? (attr.start ?? 0) - 1
        : (attr.start ?? 0);
    return { from, text: "", to: attr.end ?? 0 };
  }
  const text = `styles={{ ${written.join(", ")} }}`;
  if (attr) {
    return { from: attr.start ?? 0, text, to: attr.end ?? 0 };
  }
  const at = opening.attributes.at(-1)?.end ?? opening.name.end ?? 0;
  return { from: at, text: ` ${text}`, to: at };
}
