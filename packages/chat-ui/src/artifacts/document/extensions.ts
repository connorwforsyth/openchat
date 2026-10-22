import { Extension, type Extensions } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";

import type { BlockMenuItem } from "./blocks";

// The editor's schema (126): exactly the nodes and marks the Document kind
// stores (`@workspace/artifacts-kit/kinds/document/schema`), so what the
// editor saves passes the kind's checks and what the model wrote loads.

/** Links a document may hold; the kind's checks refuse anything else. */
const SAFE_LINK = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

export const blockMenuPluginKey = new PluginKey("documentBlockMenu");

export type BlockMenuSuggestion = Omit<
  SuggestionOptions<BlockMenuItem, BlockMenuItem>,
  "allow" | "char" | "editor" | "pluginKey"
>;

/**
 * `/` at the start of a line or after a space opens the block menu, except
 * in a code block, where a slash is code.
 */
const BlockMenu = Extension.create<{ suggestion: BlockMenuSuggestion }>({
  addOptions() {
    return { suggestion: {} };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        allow: ({ range, state }) =>
          !state.doc.resolve(range.from).parent.type.spec.code,
        char: "/",
        editor: this.editor,
        pluginKey: blockMenuPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
  name: "documentBlockMenu",
});

export const documentExtensions = (
  placeholder: string,
  blockMenu?: BlockMenuSuggestion
): Extensions => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: {
      autolink: true,
      defaultProtocol: "https",
      isAllowedUri: (url, context) =>
        context.defaultValidate(url) && SAFE_LINK.test(url),
      openOnClick: false,
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Image.configure({ inline: false }),
  Placeholder.configure({ placeholder }),
  ...(blockMenu ? [BlockMenu.configure({ suggestion: blockMenu })] : []),
];
