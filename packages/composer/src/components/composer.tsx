"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Editor, Range } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { exitSuggestion } from "@tiptap/suggestion";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { PromptInputHeader } from "@workspace/ui/components/ai-elements/prompt-input";
import { InputGroup } from "@workspace/ui/components/input-group";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { acceptAttribute, filesFromTransfer } from "../attachments";
import { textToDoc, textToInline } from "../doc";
import { createComposerExtensions, slashPluginKey } from "../editor/extensions";
import { useAttachments } from "../hooks/use-attachments";
import { useFileDrop } from "../hooks/use-file-drop";
import {
  type MenuList,
  useSuggestionMenus,
} from "../hooks/use-suggestion-menus";
import { fileCandidate, mentionCandidates } from "../mentions";
import {
  filterMentions,
  type SlashItem,
  type SlashSources,
  slashItems,
} from "../options";
import type { ComposerHandoff, ComposerProps } from "../props";
import type {
  AttachmentLimits,
  AttachmentRejection,
  FileCandidate,
  MentionCandidate,
  PromptOption,
} from "../schemas";
import { OPEN_TRIGGER } from "../triggers";
import { buildComposerValue, hasContent } from "../value";
import { type PromptVariable, resolvePromptVariables } from "../variables";
import { AttachmentList, RejectionMessage } from "./attachment-list";
import { ComposerFooter } from "./composer-footer";
import { EDITOR_CLASS, FRAME_CLASS } from "./styles";
import { optionId, SuggestionMenu } from "./suggestion-menu";
import { TemplateVariables } from "./template-variables";

export type { ComposerProps } from "../props";

export interface EditorComposerProps extends ComposerProps {
  /** Text, caret and focus from the shell, when the loader swaps this in. */
  readonly handoff?: ComposerHandoff;
}

/** What the editor's plugins call; refreshed after every render. */
interface LiveHandlers {
  readonly addFiles: (files: readonly File[]) => void;
  readonly candidates: readonly MentionCandidate[];
  readonly chooseSlash: (editor: Editor, range: Range, item: SlashItem) => void;
  readonly removeLastAttachment: () => boolean;
  readonly slash: SlashSources;
  readonly submit: () => void;
}

interface PendingTemplate {
  readonly prompt: PromptOption;
  readonly range: Range;
  readonly variables: readonly PromptVariable[];
}

const NONE: readonly never[] = [];
const NO_LIMITS: AttachmentLimits = {};

/** Marked once the editor can take input; see the README's loading notes. */
export const READY_MARK = "composer:ready";

/**
 * The prompt composer: a TipTap editor with `/` templates and `@` mentions,
 * files, the model/agent picker and the chat context chip. It owns only the
 * draft; everything else arrives as props and leaves through callbacks, so
 * any surface (a chat, Quick AI, an agent's test chat) can host it.
 *
 * Client-only: render it through ComposerLoader, which paints ComposerShell
 * first (and on the server) and loads this module as its own chunk.
 */
export function Composer({
  agents = NONE,
  attachmentLimits = NO_LIMITS,
  className,
  commands = NONE,
  context,
  contextLocked,
  contexts = NONE,
  disabled = false,
  files: workspaceFiles = NONE,
  handoff,
  models = NONE,
  onAttachmentsChange,
  onAttachmentsRejected,
  onCommand,
  onContextChange,
  onStop,
  onSubmit,
  onTargetChange,
  onVariantChange,
  onWebSearchChange,
  people = NONE,
  placeholder,
  prompts = NONE,
  recentsKey,
  status = "ready",
  target,
  variant,
  webSearch = false,
}: EditorComposerProps) {
  const { t } = useLingui();
  const id = useId();
  const listboxId = `${id}-suggestions`;
  const hintId = `${id}-hint`;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(handoff?.text ?? "");
  const [templateId, setTemplateId] = useState<LibraryItemId | null>(null);
  const [pendingTemplate, setPendingTemplate] =
    useState<PendingTemplate | null>(null);

  const files = useAttachments({
    disabled,
    limits: attachmentLimits,
    onChange: onAttachmentsChange,
    onRejected: onAttachmentsRejected,
  });
  const drop = useFileDrop(files.add, disabled);
  const menus = useSuggestionMenus();
  const candidates = useMemo(
    () => mentionCandidates(agents, people, workspaceFiles),
    [agents, people, workspaceFiles]
  );
  const slash = useMemo(
    (): SlashSources => ({
      commands,
      files: workspaceFiles.map(fileCandidate),
      prompts,
    }),
    [commands, prompts, workspaceFiles]
  );

  const busy = status === "submitted" || status === "streaming";
  const canSubmit =
    !(disabled || busy) &&
    pendingTemplate === null &&
    hasContent({ attachments: files.attachments, text });

  // The editor is built once; its plugins call back through this ref so they
  // always see the current props and state.
  const live = useRef<LiveHandlers>({
    addFiles: files.add,
    candidates,
    chooseSlash: () => undefined,
    removeLastAttachment: () => false,
    slash,
    submit: () => undefined,
  });

  const editor = useEditor(
    {
      autofocus: handoff?.focused ? handoff.caret + 1 : false,
      content: handoff?.text ? textToDoc(handoff.text) : "",
      editable: !disabled,
      editorProps: {
        attributes: {
          "aria-describedby": hintId,
          "aria-label": t`Message`,
          "aria-multiline": "true",
          class: EDITOR_CLASS,
          "data-slot": "input-group-control",
          role: "textbox",
        },
        // Files go to the composer's own drop handler on the form.
        handleDrop: (_view, event) =>
          (event.dataTransfer?.files.length ?? 0) > 0,
        // Paste is plain text: formatting from a web page or document means
        // nothing to a model. Pasted files become attachments.
        handlePaste: (view, event) => {
          const pasted = filesFromTransfer(event.clipboardData);
          if (pasted.length > 0) {
            live.current.addFiles(pasted);
            return true;
          }
          const plain = event.clipboardData?.getData("text/plain") ?? "";
          if (plain === "") {
            return false;
          }
          const { from, to } = view.state.selection;
          editor?.commands.insertContentAt({ from, to }, textToInline(plain));
          return true;
        },
      },
      extensions: createComposerExtensions({
        keys: {
          onBackspaceEmpty: () => live.current.removeLastAttachment(),
          onSubmitKey: () => {
            if (menus.isOpen()) {
              return false;
            }
            live.current.submit();
            return true;
          },
        },
        mention: {
          items: ({ query }) => [
            ...filterMentions(live.current.candidates, query),
          ],
          render: menus.mentionRenderer,
        },
        placeholder: placeholder ?? t`Ask anything`,
        slash: {
          command: ({ editor: current, props: item, range }) =>
            live.current.chooseSlash(current, range, item),
          items: ({ query }) => [...slashItems(query, live.current.slash)],
          render: menus.slashRenderer,
        },
      }),
      immediatelyRender: true,
      onCreate: () => {
        performance.mark(READY_MARK);
      },
      onUpdate: ({ editor: current }) => setText(current.getText()),
      shouldRerenderOnTransaction: false,
    },
    []
  );

  const submit = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    onSubmit(
      buildComposerValue({
        attachments: files.attachments,
        doc: editor.getJSON(),
        templateId,
      })
    );
    editor.commands.clearContent(true);
    setTemplateId(null);
    files.clear();
  }, [canSubmit, editor, files, onSubmit, templateId]);

  const choosePrompt = useCallback(
    (current: Editor, range: Range, prompt: PromptOption) => {
      const variables = resolvePromptVariables(prompt.definition);
      if (variables.length === 0) {
        current
          .chain()
          .focus()
          .insertContentAt(range, textToInline(prompt.definition.template))
          .run();
        setTemplateId(prompt.id);
        return;
      }
      // Close the menu but keep `/command` in place until the form is done.
      exitSuggestion(current.view, slashPluginKey);
      setPendingTemplate({ prompt, range, variables });
    },
    []
  );

  const chooseSlash = useCallback(
    (current: Editor, range: Range, item: SlashItem) => {
      switch (item.kind) {
        case "prompt":
          choosePrompt(current, range, item.prompt);
          return;
        case "command":
          // `/open` becomes `/open:`, which the same menu lists files for.
          // With no files to list, the host decides what opening means.
          if (item.command === "open" && slash.files.length > 0) {
            current
              .chain()
              .focus()
              .insertContentAt(range, {
                text: `/${OPEN_TRIGGER}`,
                type: "text",
              })
              .run();
            return;
          }
          // A command is an action, not words to send: its text goes.
          current.chain().focus().deleteRange(range).run();
          onCommand?.(item.command);
          return;
        case "file":
          current.chain().focus().deleteRange(range).run();
          onCommand?.("open", item.file.path);
          return;
        default:
          return item satisfies never;
      }
    },
    [choosePrompt, onCommand, slash.files.length]
  );

  // From the + menu: the same file mention `@` makes, at the caret.
  const addWorkspaceFile = useCallback(
    (file: FileCandidate) => {
      editor
        .chain()
        .focus()
        .insertContent([
          {
            attrs: { id: file.path, kind: "file", label: file.label },
            type: "mention",
          },
          { text: " ", type: "text" },
        ])
        .run();
    },
    [editor]
  );

  // From the + menu: as if chosen from `/`, over whatever is selected.
  const usePrompt = useCallback(
    (prompt: PromptOption) => {
      const { from, to } = editor.state.selection;
      choosePrompt(editor, { from, to }, prompt);
    },
    [choosePrompt, editor]
  );

  const removeLastAttachment = useCallback(() => {
    const last = files.attachments.at(-1);
    if (last === undefined) {
      return false;
    }
    files.remove(last.id);
    return true;
  }, [files]);

  useLayoutEffect(() => {
    live.current = {
      addFiles: files.add,
      candidates,
      chooseSlash,
      removeLastAttachment,
      slash,
      submit,
    };
  });

  // Mention candidates and files can land while a menu is open (the
  // workspace listing, 065); the plugins wouldn't ask again until the next
  // keystroke. Runs after the layout effect above, so the plugins' own next
  // ask sees the same lists.
  const { refresh: refreshMenus } = menus;
  useEffect(() => {
    refreshMenus({
      mentions: (query) => filterMentions(candidates, query),
      slash: (query) => slashItems(query, slash),
    });
  }, [candidates, refreshMenus, slash]);

  useEffect(() => {
    editor.setEditable(!disabled && pendingTemplate === null, false);
  }, [disabled, editor, pendingTemplate]);

  // A template's text is gone once the editor is empty again.
  useEffect(() => {
    if (text.trim() === "") {
      setTemplateId(null);
    }
  }, [text]);

  // aria-activedescendant points screen readers at the active option while
  // focus stays in the editor, the ARIA pattern for autocomplete in a text field.
  useEffect(() => {
    const { dom } = editor.view;
    if (menus.menu) {
      dom.setAttribute("aria-autocomplete", "list");
      dom.setAttribute("aria-controls", listboxId);
      dom.setAttribute(
        "aria-activedescendant",
        optionId(listboxId, menus.active)
      );
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
    dom.setAttribute("aria-disabled", String(disabled));
  }, [disabled, editor, listboxId, menus.active, menus.menu]);

  const insertTemplate = useCallback(
    (filled: string) => {
      if (pendingTemplate === null) {
        return;
      }
      editor.setEditable(true, false);
      editor
        .chain()
        .focus()
        .insertContentAt(pendingTemplate.range, textToInline(filled))
        .run();
      setTemplateId(pendingTemplate.prompt.id);
      setPendingTemplate(null);
    },
    [editor, pendingTemplate]
  );

  const cancelTemplate = useCallback(() => {
    setPendingTemplate(null);
    // Leave the `/command` as typed; the menu stays dismissed for it.
    editor.setEditable(true, false);
    editor.commands.focus(pendingTemplate?.range.to);
  }, [editor, pendingTemplate]);

  const removeAttachment = useCallback(
    (attachmentId: string) => {
      files.remove(attachmentId);
      // The chip and its button are gone; keep focus in the composer.
      editor.commands.focus();
    },
    [editor, files]
  );

  const stop = useCallback(() => {
    onStop?.();
    editor.commands.focus();
  }, [editor, onStop]);

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const picks = event.currentTarget.files;
      files.add(picks ? Array.from(picks) : NONE);
      // Clearing lets the same file be picked again after removing it.
      event.currentTarget.value = "";
      editor.commands.focus();
    },
    [editor, files]
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit]
  );

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const menuTitles: Record<MenuList, string> = {
    commands: t`Commands`,
    files: t`Files`,
    mentions: t`Mention`,
    prompts: t`Prompts`,
  };
  const suggestionCount = menus.menu?.items.length ?? 0;

  return (
    <form
      className={cn("relative w-full", className)}
      data-dragging={drop.dragging || undefined}
      data-slot="composer"
      onSubmit={handleSubmit}
      {...drop.handlers}
    >
      <input
        accept={acceptAttribute(attachmentLimits)}
        aria-hidden
        className="hidden"
        multiple
        onChange={handleFileInput}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      {menus.menu ? (
        <SuggestionMenu
          activeIndex={menus.active}
          id={listboxId}
          items={menus.menu.items}
          onChoose={menus.menu.select}
          onHover={menus.hover}
          title={menuTitles[menus.menu.list]}
        />
      ) : null}
      <InputGroup
        className={cn(
          FRAME_CLASS,
          drop.dragging && "border-ring ring-3 ring-ring/50"
        )}
      >
        {pendingTemplate ? (
          <TemplateVariables
            onCancel={cancelTemplate}
            onInsert={insertTemplate}
            prompt={pendingTemplate.prompt}
            variables={pendingTemplate.variables}
          />
        ) : null}
        {files.attachments.length > 0 ? (
          <PromptInputHeader className="cursor-default">
            <AttachmentList
              attachments={files.attachments}
              disabled={disabled}
              onRemove={removeAttachment}
            />
          </PromptInputHeader>
        ) : null}
        <EditorContent
          className={cn("w-full min-w-0", disabled && "opacity-50")}
          editor={editor}
        />
        <ComposerFooter
          agents={agents}
          attachDisabled={disabled || files.atLimit}
          busy={busy}
          canSubmit={canSubmit}
          context={context}
          contextLocked={contextLocked}
          contexts={contexts}
          disabled={disabled}
          files={slash.files}
          models={models}
          onAddFile={addWorkspaceFile}
          onAttach={openFilePicker}
          onContextChange={onContextChange}
          onStop={onStop ? stop : undefined}
          onTargetChange={onTargetChange}
          onUsePrompt={usePrompt}
          onVariantChange={onVariantChange}
          onWebSearchChange={onWebSearchChange}
          prompts={prompts}
          recentsKey={recentsKey}
          target={target}
          variant={variant}
          webSearch={webSearch}
        />
      </InputGroup>
      <div aria-live="polite" className="sr-only">
        {menus.menu ? (
          <Plural
            one="# suggestion"
            other="# suggestions"
            value={suggestionCount}
          />
        ) : null}
      </div>
      <RejectionAlert rejections={files.rejections} />
      <p className="sr-only" id={hintId}>
        <Trans>
          Enter sends and Shift+Enter adds a line. Type / for commands and
          prompts, and @ to mention someone or a file.
        </Trans>
      </p>
    </form>
  );
}

function RejectionAlert({
  rejections,
}: {
  readonly rejections: readonly AttachmentRejection[];
}) {
  if (rejections.length === 0) {
    return null;
  }
  return (
    <div
      className="mt-1.5 flex flex-col gap-0.5 text-destructive text-xs"
      role="alert"
    >
      {rejections.map((rejection) => (
        <p key={`${rejection.code}:${rejection.fileName}`}>
          <RejectionMessage rejection={rejection} />
        </p>
      ))}
    </div>
  );
}
