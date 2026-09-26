import { type AnyExtension, Extension } from "@tiptap/core";
import { Code } from "@tiptap/extension-code";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Mention, type MentionOptions } from "@tiptap/extension-mention";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";

import type { MentionCandidate, PromptOption } from "../schemas";

// The editor schema is deliberately small: paragraphs, hard breaks, inline
// code and mentions. No headings, lists or links; a chat message is text,
// and anything richer is Markdown the model reads as written. Every
// extension here is TipTap's MIT open-source core; nothing from TipTap
// Pro or its cloud.

/** Which plugin a suggestion event came from. */
export const slashPluginKey = new PluginKey("composerSlash");
export const mentionPluginKey = new PluginKey("composerMention");

/** What a mention node stores. `kind` is ours; Mention itself has id and label. */
export type MentionAttrs = Pick<MentionCandidate, "id" | "kind" | "label">;

export type SlashSuggestion = Omit<
  SuggestionOptions<PromptOption, PromptOption>,
  "editor" | "pluginKey"
>;
export type MentionSuggestion = Omit<
  SuggestionOptions<MentionCandidate, MentionAttrs>,
  "editor" | "pluginKey"
>;

export interface ComposerKeyHandlers {
  /** Backspace in an empty editor; true if it took back an attachment. */
  readonly onBackspaceEmpty: () => boolean;
  /**
   * Enter or Mod+Enter. Return false while a suggestion menu is open: this
   * keymap runs before the Suggestion plugins, which then pick the option.
   */
  readonly onSubmitKey: () => boolean;
}

export interface ComposerExtensionOptions {
  readonly keys: ComposerKeyHandlers;
  readonly mention: MentionSuggestion;
  readonly placeholder: string;
  readonly slash: SlashSuggestion;
}

/** `/` opens prompt templates. A plain Suggestion plugin: choosing inserts text, not a node. */
const SlashCommand = Extension.create<{ suggestion: SlashSuggestion }>({
  addOptions() {
    return { suggestion: {} };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        char: "/",
        editor: this.editor,
        pluginKey: slashPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
  name: "composerSlash",
});

const ComposerMention = Mention.extend<
  MentionOptions<MentionCandidate, MentionAttrs>
>({
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
    };
  },
});

// Only Shift+Enter makes a line break; Enter and Mod+Enter send.
const LineBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
  },
});

const ComposerKeys = Extension.create<{ keys: ComposerKeyHandlers }>({
  addKeyboardShortcuts() {
    const { keys } = this.options;
    return {
      Backspace: () => this.editor.isEmpty && keys.onBackspaceEmpty(),
      Enter: () => keys.onSubmitKey(),
      "Mod-Enter": () => keys.onSubmitKey(),
    };
  },
  name: "composerKeys",
  // Ahead of ProseMirror's base keymap, which would split the paragraph.
  priority: 1000,
});

export const createComposerExtensions = ({
  keys,
  mention,
  placeholder,
  slash,
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
  Placeholder.configure({ placeholder }),
  ComposerMention.configure({
    deleteTriggerWithBackspace: true,
    HTMLAttributes: {
      class: "rounded-sm bg-accent px-0.5 text-accent-foreground",
    },
    suggestion: { char: "@", pluginKey: mentionPluginKey, ...mention },
  }),
  SlashCommand.configure({ suggestion: slash }),
  ComposerKeys.configure({ keys }),
];
