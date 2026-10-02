import type { Extensions } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { StarterKit } from "@tiptap/starter-kit";

// The editor's schema (126): exactly the nodes and marks the Document kind
// stores (`@workspace/artifacts-kit/kinds/document/schema`), so what the
// editor saves passes the kind's checks and what the model wrote loads.

/** Links a document may hold; the kind's checks refuse anything else. */
const SAFE_LINK = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

export const documentExtensions = (placeholder: string): Extensions => [
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
];
