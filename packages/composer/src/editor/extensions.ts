import { type AnyExtension, Extension, Node } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";

import { VARIABLE_NODE } from "../doc";
import type { MenuItem } from "../options";
import type { PromptHistoryDirection } from "../prompt-history";
import type { MentionToken } from "../schemas";
import { ChipView, VariableView } from "./node-views";

// The editor schema is deliberately small: paragraphs, hard breaks, inline
// code, chips and a prompt's variables. No headings, lists or links; a chat
// message is text, and anything richer is Markdown the model reads as
// written. Every extension here is TipTap's MIT open-source core; nothing
// from TipTap Pro or its cloud.

/** Which plugin a suggestion event came from. */
export const slashPluginKey = new PluginKey("composerSlash");
export const mentionPluginKey = new PluginKey("composerMention");

/**
 * What a chip node stores. `kind` and `versionId` are ours; Mention itself
 * has id and label. A file's `id` is its workspace path, an artifact
 * chip's its kind; `versionId` pins an owner's draft.
 */
export interface MentionAttrs {
  readonly id: string;
  readonly kind: MentionToken["kind"];
  readonly label: string;
  readonly versionId?: string | null;
}

/** `/` and `@` open the same menu; choosing runs the composer's handler. */
export type MenuSuggestion = Omit<
  SuggestionOptions<MenuItem, MenuItem>,
  "char" | "editor" | "pluginKey"
>;

export interface ComposerKeyHandlers {
  /** Backspace in an empty editor; true if it took back an attachment. */
  readonly onBackspaceEmpty: () => boolean;
  /**
   * ArrowUp (`backward`) or ArrowDown (`forward`): true if it recalled a
   * prompt (147). Return false while a suggestion menu is open, so the
   * menu moves its selection, and whenever the caret should just move.
   */
  readonly onHistoryKey: (direction: PromptHistoryDirection) => boolean;
  /**
   * Enter or Mod+Enter. Return false while a suggestion menu is open: this
   * keymap runs before the Suggestion plugins, which then pick the option.
   */
  readonly onSubmitKey: () => boolean;
  /** Whether Tab may move between a prompt's variables: not while a menu is open. */
  readonly variablesActive: () => boolean;
}

export interface ComposerExtensionOptions {
  readonly keys: ComposerKeyHandlers;
  readonly menu: MenuSuggestion;
  /** A function is read on every redraw, so it can change after mount. */
  readonly placeholder: string | (() => string);
}

const ComposerMention = Mention.extend<MentionOptions<MenuItem, MenuItem>>({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: "user",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-kind"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-kind": attributes.kind,
        }),
      },
      versionId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-version-id"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.versionId
            ? { "data-version-id": attributes.versionId }
            : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ChipView, { as: "span" });
  },
});

/**
 * A prompt's `{{variable}}` in the text (see `templateToInline`): an atom
 * that Tab selects, so typing replaces it. Left unfilled, it's sent as its
 * default, or dropped.
 */
const PromptVariable = Node.create({
  addAttributes() {
    return {
      description: { default: null },
      fallback: { default: null },
      name: { default: "" },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(VariableView, { as: "span" });
  },
  atom: true,
  group: "inline",
  inline: true,
  name: VARIABLE_NODE,
  parseHTML: () => [{ tag: "span[data-variable]" }],
  renderHTML: ({ node }) => [
    "span",
    { "data-variable": node.attrs.name },
    String(node.attrs.name),
  ],
  renderText: () => "",
  selectable: true,
});

/** Positions of the prompt variables still in the document, in order. */
const variablePositions = (doc: ProseMirrorNode): number[] => {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === VARIABLE_NODE) {
      positions.push(pos);
    }
  });
  return positions;
};

// Only Shift+Enter makes a line break; Enter and Mod+Enter send.
const LineBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    composerVariables: {
      /** Selects the next (or previous) prompt variable; false when there's none. */
      selectVariable: (direction: "next" | "previous") => ReturnType;
    };
  }
}

const ComposerKeys = Extension.create<{ keys: ComposerKeyHandlers }>({
  addCommands() {
    return {
      selectVariable:
        (direction) =>
        ({ dispatch, state, tr }) => {
          const positions = variablePositions(state.doc);
          if (positions.length === 0) {
            return false;
          }
          const { from } = state.selection;
          const selected =
            state.selection instanceof NodeSelection ? from : undefined;
          const target =
            direction === "next"
              ? (positions.find((pos) =>
                  selected === undefined ? pos >= from : pos > selected
                ) ?? positions[0])
              : (positions.filter((pos) => pos < (selected ?? from)).at(-1) ??
                positions.at(-1));
          if (target === undefined) {
            return false;
          }
          if (dispatch) {
            tr.setSelection(NodeSelection.create(tr.doc, target));
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    const { keys } = this.options;
    return {
      // Not while an input method is composing: its arrows pick candidates.
      ArrowDown: () =>
        !this.editor.view.composing && keys.onHistoryKey("forward"),
      ArrowUp: () =>
        !this.editor.view.composing && keys.onHistoryKey("backward"),
      Backspace: () => this.editor.isEmpty && keys.onBackspaceEmpty(),
      Enter: () => keys.onSubmitKey(),
      "Mod-Enter": () => keys.onSubmitKey(),
      "Shift-Tab": () =>
        keys.variablesActive() &&
        this.editor.commands.selectVariable("previous"),
      Tab: () =>
        keys.variablesActive() && this.editor.commands.selectVariable("next"),
    };
  },
  name: "composerKeys",
  // Ahead of ProseMirror's base keymap, which would split the paragraph.
  priority: 1000,
});

export const createComposerExtensions = ({
  keys,
  menu,
  placeholder,
}: ComposerExtensionOptions): AnyExtension[] => [
  Document,
  Paragraph,
  Text,
  LineBreak,
  Code.configure({
    HTMLAttributes: {
      class: "rounded-sm bg-muted px-1 font-mono text-[0.9em]",
    },
  }),
  UndoRedo,
  Placeholder.configure({
    placeholder:
      typeof placeholder === "function" ? () => placeholder() : placeholder,
  }),
  ComposerMention.configure({
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => `@${node.attrs.label ?? ""}`,
    suggestions: [
      { char: "@", pluginKey: mentionPluginKey, ...menu },
      { char: "/", pluginKey: slashPluginKey, ...menu },
    ],
  }),
  PromptVariable,
  ComposerKeys.configure({ keys }),
];
