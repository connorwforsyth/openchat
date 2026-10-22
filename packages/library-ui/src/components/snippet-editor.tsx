"use client";

import { useLingui } from "@lingui/react/macro";
import { type Editor, Extension, type Range } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Fragment, type Node, Slice } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { MenuLabel } from "@workspace/composer/components/menu-listbox";
import { SuggestionPopup } from "@workspace/composer/components/suggestion-popup";
import { useSuggestionPopup } from "@workspace/composer/hooks/use-suggestion-popup";
import {
  CodeIcon,
  FileTextIcon,
  PlusIcon,
  SparklesIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  atVariableEnd,
  NEW_VARIABLE_NAME,
  PLACEHOLDER,
  type SnippetItem,
  snippetText,
  snippetToDoc,
} from "../snippet";

// The library's plain-text editor (agent instructions, prompt templates,
// SKILL.md): a line per paragraph, `{{variables}}` highlighted, and a `/`
// menu that inserts snippets. Controlled like a textarea.

export interface SnippetMenu {
  readonly items: (query: string) => readonly SnippetItem[];
  /** Inserts what it returns in place of `/query`; `null` inserts nothing. */
  readonly onPick: (
    item: SnippetItem
  ) => Promise<string | null> | string | null;
  readonly title: string;
}

export interface SnippetEditorProps {
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-labelledby"?: string;
  readonly className?: string;
  readonly id?: string;
  readonly menu?: SnippetMenu;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly spellCheck?: boolean;
  readonly value: string;
}

// Textarea's frame, so the editors sit with the other fields.
const FRAME =
  "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

const BEHAVIOUR =
  "whitespace-pre-wrap break-words [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-start [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]";

const PLACEHOLDER_CLASS =
  "rounded-sm bg-accent font-mono text-accent-foreground";

const snippetMenuKey = new PluginKey("snippetMenu");
const placeholdersKey = new PluginKey<DecorationSet>("snippetPlaceholders");

const placeholderDecorations = (doc: Node): DecorationSet => {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }
    for (const match of (node.text ?? "").matchAll(PLACEHOLDER)) {
      const from = pos + match.index;
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: PLACEHOLDER_CLASS,
        })
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
};

/** Highlights each `{{name}}`, as the composer will read it. */
const Placeholders = Extension.create({
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: placeholdersKey,
        props: {
          decorations: (state: EditorState) => placeholdersKey.getState(state),
        },
        state: {
          apply: (tr, old) =>
            tr.docChanged ? placeholderDecorations(tr.doc) : old,
          init: (_, state) => placeholderDecorations(state.doc),
        },
      }),
    ];
  },
  name: "snippetPlaceholders",
});

/** Space or Tab at the end of a placeholder's name steps past its `}}`. */
const leaveVariable = (editor: Editor, insert: string): boolean => {
  const { $from, empty } = editor.state.selection;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  if (!(empty && atVariableEnd(text.slice(0, offset), text.slice(offset)))) {
    return false;
  }
  const after = $from.pos + "}}".length;
  return editor.chain().setTextSelection(after).insertContent(insert).run();
};

const VariableExit = Extension.create({
  addKeyboardShortcuts() {
    return {
      Space: () => leaveVariable(this.editor, " "),
      Tab: () => leaveVariable(this.editor, ""),
    };
  },
  name: "snippetVariableExit",
});

type MenuSuggestion = Omit<
  SuggestionOptions<SnippetItem, SnippetItem>,
  "char" | "editor" | "pluginKey"
>;

const SlashMenu = Extension.create<{ suggestion: MenuSuggestion }>({
  addOptions() {
    return { suggestion: {} };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        char: "/",
        editor: this.editor,
        pluginKey: snippetMenuKey,
        ...this.options.suggestion,
      }),
    ];
  },
  name: "snippetMenu",
});

/** Text as a slice that joins the paragraphs either side, the way pasting does. */
const textSlice = (state: EditorState, text: string): Slice => {
  const { schema } = state;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return Slice.maxOpen(
    Fragment.from(
      lines.map((line) =>
        schema.node("paragraph", null, line ? schema.text(line) : undefined)
      )
    )
  );
};

/** Puts `text` over `range`; a new variable's name ends up selected. */
const insertSnippet = (
  editor: Editor,
  range: Range,
  text: string,
  selectName: boolean
) => {
  const { state, view } = editor;
  const tr = state.tr.replace(range.from, range.to, textSlice(state, text));
  view.dispatch(tr.scrollIntoView());
  if (selectName) {
    const start = range.from + "{{".length;
    editor.commands.setTextSelection({
      from: start,
      to: start + NEW_VARIABLE_NAME.length,
    });
  }
  editor.commands.focus();
};

const itemKey = (item: SnippetItem): string => {
  switch (item.kind) {
    case "skill":
    case "prompt":
      return `${item.kind}-${item.id}`;
    case "variable":
      return `variable-${item.name}`;
    case "new-variable":
      return "new-variable";
    default:
      return item satisfies never;
  }
};

const useRenderItem = () => {
  const { t } = useLingui();
  return useCallback(
    (item: SnippetItem) => {
      switch (item.kind) {
        case "skill":
          return (
            <>
              <SparklesIcon aria-hidden />
              <MenuLabel
                hint={item.attached ? t`Attached` : t`Skill`}
                label={item.name}
              />
            </>
          );
        case "prompt":
          return (
            <>
              <FileTextIcon aria-hidden />
              <MenuLabel hint={t`Prompt`} label={item.name} />
            </>
          );
        case "variable":
          return (
            <>
              <CodeIcon aria-hidden />
              <MenuLabel hint={item.description} label={item.name} />
            </>
          );
        case "new-variable":
          return (
            <>
              <PlusIcon aria-hidden />
              <MenuLabel label={t`New variable`} />
            </>
          );
        default:
          return item satisfies never;
      }
    },
    [t]
  );
};

export function SnippetEditor({
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-labelledby": labelledBy,
  className,
  id,
  menu,
  onValueChange,
  placeholder = "",
  readOnly = false,
  spellCheck = true,
  value,
}: SnippetEditorProps) {
  const popupId = useId();
  const renderItem = useRenderItem();
  const popup = useSuggestionPopup<SnippetItem>();
  const { render } = popup;
  // The extensions are made once; the plugin reads the latest props here.
  const latest = useRef({ menu, onValueChange });
  latest.current = { menu, onValueChange };
  const hasMenu = useRef(menu !== undefined).current;

  const extensions = useMemo(() => {
    const suggestion: MenuSuggestion = {
      command: ({ editor: target, props: item, range }) => {
        const picked = latest.current.menu?.onPick(item) ?? null;
        const selectName = item.kind === "new-variable";
        if (picked === null || typeof picked === "string") {
          insertSnippet(target, range, picked ?? "", selectName);
          return;
        }
        // Fetched (a prompt's template): the query goes at once, so the
        // menu closes, and the text lands where it was when it arrives.
        insertSnippet(target, range, "", false);
        picked
          .then((text) => {
            if (text !== null && !target.isDestroyed) {
              const at = Math.min(range.from, target.state.doc.content.size);
              insertSnippet(target, { from: at, to: at }, text, selectName);
            }
          })
          .catch(() => undefined);
      },
      items: ({ query }) => [...(latest.current.menu?.items(query) ?? [])],
      render,
    };
    return [
      Document,
      Paragraph,
      Text,
      UndoRedo,
      Placeholder.configure({ placeholder }),
      Placeholders,
      VariableExit,
      ...(hasMenu ? [SlashMenu.configure({ suggestion })] : []),
    ];
  }, [hasMenu, placeholder, render]);

  // The popup's ARIA goes on the editable element, which exists once mounted.
  const [editable, setEditable] = useState<HTMLElement | null>(null);
  const editorProps = useMemo(
    () => ({
      attributes: {
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        ...(id ? { id } : {}),
        "aria-multiline": "true",
        ...(readOnly ? { "aria-readonly": "true" } : {}),
        class: cn(FRAME, BEHAVIOUR, className),
        "data-slot": "snippet-editor",
        role: "textbox",
        spellcheck: String(spellCheck),
      },
      // Plain text in and out: ProseMirror's defaults fold blank lines on
      // paste and double them on copy.
      clipboardTextSerializer: (slice: Slice) =>
        slice.content.textBetween(0, slice.content.size, "\n"),
      handlePaste: (view: Editor["view"], event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) {
          return false;
        }
        view.dispatch(
          view.state.tr
            .replaceSelection(textSlice(view.state, text))
            .scrollIntoView()
        );
        return true;
      },
    }),
    [className, describedBy, id, invalid, labelledBy, readOnly, spellCheck]
  );
  const editor = useEditor(
    {
      content: snippetToDoc(value),
      editable: !readOnly,
      editorProps,
      extensions,
      immediatelyRender: false,
      onMount: ({ editor: mounted }) => setEditable(mounted.view.dom),
      onUpdate: ({ editor: updated, transaction }) => {
        if (transaction.docChanged) {
          latest.current.onValueChange(snippetText(updated));
        }
      },
      shouldRerenderOnTransaction: false,
    },
    []
  );

  useEffect(() => {
    editor?.setOptions({ editorProps });
  }, [editor, editorProps]);
  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  // A value set from outside (a version restored, the form reset) replaces
  // the text; the editor's own edits come back equal and are left alone.
  useEffect(() => {
    if (editor && snippetText(editor) !== value) {
      editor.commands.setContent(snippetToDoc(value), { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <>
      <EditorContent editor={editor} />
      {menu ? (
        <SuggestionPopup
          id={popupId}
          itemKey={itemKey}
          menu={popup.menu}
          onChoose={popup.choose}
          onHover={popup.hover}
          renderItem={renderItem}
          target={editable}
          title={menu.title}
        />
      ) : null}
    </>
  );
}
