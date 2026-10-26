"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Editor, Range } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import {
  InputGroup,
  InputGroupAddon,
} from "@workspace/ui/components/input-group";
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
import { MENTION_NODE, textToDoc, textToInline } from "../doc";
import { draftDoc } from "../drafts";
import {
  createComposerExtensions,
  type MentionAttrs,
} from "../editor/extensions";
import { useAttachments } from "../hooks/use-attachments";
import { useDraft } from "../hooks/use-draft";
import { useFileDrop } from "../hooks/use-file-drop";
import { usePromptRecall } from "../hooks/use-prompt-recall";
import { useSuggestionMenus } from "../hooks/use-suggestion-menus";
import { fileCandidate, mentionCandidates } from "../mentions";
import { type MenuItem, type MenuSources, menuItems } from "../options";
import type { Draft } from "../ports/draft-store";
import type { PromptHistoryDirection } from "../prompt-history";
import type { ComposerHandoff, ComposerMcp, ComposerProps } from "../props";
import type {
  AttachmentLimits,
  AttachmentRejection,
  FileCandidate,
  PromptOption,
  SkillOption,
} from "../schemas";
import { OPEN_TRIGGER } from "../triggers";
import { buildComposerValue, hasContent } from "../value";
import { templateToInline } from "../variables";
import { AttachmentList, RejectionMessage } from "./attachment-list";
import { ComposerFooter } from "./composer-footer";
import { optionId } from "./menu-listbox";
import { LOOKS } from "./styles";
import { SuggestionMenu } from "./suggestion-menu";

export type { ComposerProps } from "../props";

export interface EditorComposerProps extends ComposerProps {
  /** Text, caret and focus from the shell, when the loader swaps this in. */
  readonly handoff?: ComposerHandoff;
}

/** What the editor's plugins call; refreshed after every render. */
interface LiveHandlers {
  readonly addFiles: (files: readonly File[]) => void;
  readonly choose: (editor: Editor, range: Range, item: MenuItem) => void;
  readonly draftChanged: () => void;
  readonly items: (query: string) => readonly MenuItem[];
  readonly recallPrompt: (direction: PromptHistoryDirection) => boolean;
  readonly removeLastAttachment: () => boolean;
  readonly submit: (how: "send" | "steer") => void;
}

/** The chip a menu pick puts in the text; `undefined` for picks that aren't one. */
const chipFor = (item: MenuItem): MentionAttrs | undefined => {
  switch (item.kind) {
    case "agent":
      return {
        id: item.agent.id,
        kind: "agent",
        label: item.agent.name,
        versionId: item.agent.draftVersion ?? null,
      };
    case "skill":
      return {
        id: item.skill.id,
        kind: "skill",
        label: item.skill.name,
        versionId: item.skill.draftVersion ?? null,
      };
    case "artifact":
      return {
        id: item.artifact.kind,
        kind: "artifact",
        label: item.artifact.label,
      };
    case "mention":
      return {
        id:
          item.candidate.kind === "file"
            ? item.candidate.path
            : item.candidate.id,
        kind: item.candidate.kind,
        label: item.candidate.label,
      };
    case "prompt":
    case "upload":
    case "command":
    case "open-file":
    case "mcp-server":
      return;
    default:
      return item satisfies never;
  }
};

/** A chip node and the space after it, as editor content. */
const chipContent = (attrs: MentionAttrs) => [
  { attrs, type: MENTION_NODE },
  { text: " ", type: "text" },
];

const NONE: readonly never[] = [];
const NO_LIMITS: AttachmentLimits = {};

/** Marked once the editor can take input; see the README's loading notes. */
export const READY_MARK = "composer:ready";

/**
 * The prompt composer: a TipTap editor with `/` templates and `@` mentions,
 * files, the model/agent picker and its thinking level. It owns only the
 * draft; everything else arrives as props and leaves through callbacks, so
 * any surface (a chat, Quick AI, an agent's test chat) can host it.
 *
 * Client-only: render it through ComposerLoader, which paints ComposerShell
 * first (and on the server) and loads this module as its own chunk.
 */
/** The placeholder, in a ref the editor's plugin reads on every redraw. */
const useLivePlaceholder = (placeholder: string | undefined) => {
  const { t } = useLingui();
  const fallback = t`Ask anything`;
  const shown = useRef(placeholder ?? fallback);
  shown.current = placeholder ?? fallback;
  return shown;
};

/** The `/` menu's title for MCP servers: whatever the host calls them (191). */
const termLabel = (mcp: ComposerMcp | undefined): string =>
  mcp?.term.label ?? "";

export function Composer({
  agents = NONE,
  appearance = "default",
  artifacts = NONE,
  attachmentLimits = NO_LIMITS,
  className,
  chatMode,
  commands = NONE,
  mcp,
  disabled = false,
  draft,
  files: workspaceFiles = NONE,
  fill,
  handoff,
  history = NONE,
  mode,
  models = NONE,
  onAttachmentsChange,
  onAttachmentsRejected,
  onCommand,
  onPlanChange,
  onStop,
  onSteer,
  onSubmit,
  onTargetChange,
  onVariantChange,
  onWebSearchChange,
  people = NONE,
  placeholder,
  plan = false,
  prompts = NONE,
  recentsKey,
  skills: offeredSkills = NONE,
  status = "ready",
  target,
  variant,
  webSearch = false,
}: EditorComposerProps) {
  const { t } = useLingui();
  const look = LOOKS[appearance];
  const id = useId();
  const listboxId = `${id}-suggestions`;
  const hintId = `${id}-hint`;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(handoff?.text ?? "");
  const [templateId, setTemplateId] = useState<LibraryItemId | null>(null);

  const files = useAttachments({
    disabled,
    limits: attachmentLimits,
    onChange: onAttachmentsChange,
    onRejected: onAttachmentsRejected,
  });
  const drop = useFileDrop(files.add, disabled);
  const menus = useSuggestionMenus();
  // An owner's draft agent answers through its chip only: picked as the
  // chat's target, it would make the chat the builder's test chat (033).
  const pickable = useMemo(
    () => agents.filter((agent) => agent.draftVersion === undefined),
    [agents]
  );
  const fileOptions = useMemo(
    () => workspaceFiles.map(fileCandidate),
    [workspaceFiles]
  );
  const uploadLabel = t`Upload a file`;
  const canUpload = !(disabled || files.atLimit);
  const sources = useMemo(
    (): MenuSources => ({
      agents,
      artifacts,
      canUpload,
      commands,
      mcpServers: mcp?.servers,
      mentions: mentionCandidates(people, workspaceFiles),
      mode,
      prompts,
      skills: offeredSkills,
    }),
    [
      agents,
      artifacts,
      canUpload,
      commands,
      mcp?.servers,
      mode,
      offeredSkills,
      people,
      prompts,
      workspaceFiles,
    ]
  );
  const items = useCallback(
    (query: string) => menuItems(query, sources, uploadLabel),
    [sources, uploadLabel]
  );

  const busy = status === "submitted" || status === "streaming";
  // While an answer is being written, a host that can steer takes messages:
  // queued with Enter, steered with Mod+Enter.
  const canSubmit =
    !(disabled || (busy && onSteer === undefined)) &&
    hasContent({ attachments: files.attachments, text });

  const shownPlaceholder = useLivePlaceholder(placeholder);

  // The editor is built once; its plugins call back through this ref so they
  // always see the current props and state.
  const live = useRef<LiveHandlers>({
    addFiles: files.add,
    choose: () => undefined,
    draftChanged: () => undefined,
    items,
    recallPrompt: () => false,
    removeLastAttachment: () => false,
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
          class: look.editor,
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
          onHistoryKey: (direction) =>
            !menus.isOpen() && live.current.recallPrompt(direction),
          onSubmitKey: (how) => {
            if (menus.isOpen()) {
              return false;
            }
            live.current.submit(how);
            return true;
          },
          variablesActive: () => !menus.isOpen(),
        },
        menu: {
          command: ({ editor: current, props: item, range }) =>
            live.current.choose(current, range, item),
          items: ({ query }) => [...live.current.items(query)],
          render: menus.renderer,
        },
        // Read live, so a placeholder that arrives later ("Message Pip",
        // 172) shows without rebuilding the editor.
        placeholder: () => shownPlaceholder.current,
      }),
      immediatelyRender: true,
      onCreate: () => {
        performance.mark(READY_MARK);
      },
      onUpdate: ({ editor: current }) => {
        setText(current.getText());
        live.current.draftChanged();
      },
      shouldRerenderOnTransaction: false,
    },
    []
  );

  const promptRecall = usePromptRecall(editor, history);

  // The draft is kept per chat (147). Attachments aren't: see draft-store.ts.
  // Skills are chips in the text now; `skills` is only read from drafts
  // saved before, which kept them beside it.
  const readDraft = useCallback(
    (): Draft => ({
      doc: draftDoc(editor.getJSON()),
      skills: [],
      templateId,
      version: 1,
    }),
    [editor, templateId]
  );
  const restoreDraft = useCallback(
    (saved: Draft | null) => {
      // Not undoable: undo mustn't bring back another chat's words.
      const skills = (saved?.skills ?? []).flatMap((skill) =>
        chipContent({
          id: skill.id,
          kind: "skill",
          label: skill.name,
          versionId: skill.versionId ?? null,
        })
      );
      const chain = editor
        .chain()
        .setMeta("addToHistory", false)
        .setContent(saved?.doc ?? "", { emitUpdate: true });
      // At the start of the first paragraph.
      (skills.length > 0 ? chain.insertContentAt(1, skills) : chain).run();
      setTemplateId(saved?.templateId ?? null);
      promptRecall.reset();
    },
    [editor, promptRecall]
  );
  const draftControls = useDraft({
    draft,
    read: readDraft,
    restore: restoreDraft,
    typedFirst: Boolean(handoff?.text),
  });
  const { changed: draftChanged } = draftControls;
  // biome-ignore lint/correctness/useExhaustiveDependencies: saves when it changes; the draft is read when the write happens
  useEffect(() => {
    draftChanged();
  }, [draftChanged, templateId]);

  const submit = useCallback(
    (how: "send" | "steer" = "send") => {
      if (!canSubmit) {
        return;
      }
      const value = buildComposerValue({
        attachments: files.attachments,
        doc: editor.getJSON(),
        templateId,
      });
      if (busy && how === "steer" && onSteer) {
        onSteer(value);
      } else {
        onSubmit(value);
      }
      editor.commands.clearContent(true);
      setTemplateId(null);
      files.clear();
      promptRecall.reset();
      draftControls.sent();
    },
    [
      busy,
      canSubmit,
      draftControls,
      editor,
      files,
      onSteer,
      onSubmit,
      promptRecall,
      templateId,
    ]
  );
  const steer = useCallback(() => submit("steer"), [submit]);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  /**
   * A prompt goes in as text the person can edit, its `{{variables}}` as
   * placeholders; the first is selected, so typing fills it and Tab moves
   * to the next.
   */
  const insertPrompt = useCallback(
    (current: Editor, range: Range, prompt: PromptOption) => {
      current
        .chain()
        .focus()
        .insertContentAt(range, templateToInline(prompt.definition))
        .run();
      current.chain().setTextSelection(range.from).selectVariable("next").run();
      setTemplateId(prompt.id);
    },
    []
  );

  const choose = useCallback(
    (current: Editor, range: Range, item: MenuItem) => {
      switch (item.kind) {
        case "agent":
        case "skill":
        case "artifact":
        case "mention": {
          const chip = chipFor(item);
          if (chip) {
            current
              .chain()
              .focus()
              .insertContentAt(range, chipContent(chip))
              .run();
          }
          return;
        }
        case "prompt":
          insertPrompt(current, range, item.prompt);
          return;
        case "upload":
          current.chain().focus().deleteRange(range).run();
          openFilePicker();
          return;
        case "command":
          // `/open` becomes `/open:`, which the same menu lists files for.
          // With no files to list, the host decides what opening means.
          if (item.command === "open" && fileOptions.length > 0) {
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
        case "open-file":
          current.chain().focus().deleteRange(range).run();
          onCommand?.("open", item.file.path);
          return;
        case "mcp-server":
          // A switch for this chat (188), not words to send.
          current.chain().focus().deleteRange(range).run();
          mcp?.onToggle(item.server.id, !item.server.enabled);
          return;
        default:
          return item satisfies never;
      }
    },
    [fileOptions.length, insertPrompt, mcp, onCommand, openFilePicker]
  );

  // From the + menu: the chip `/` and `@` make, at the caret.
  const insertAtCaret = useCallback(
    (item: MenuItem) => {
      const { from, to } = editor.state.selection;
      choose(editor, { from, to }, item);
    },
    [choose, editor]
  );
  const addWorkspaceFile = useCallback(
    (file: FileCandidate) =>
      insertAtCaret({ candidate: file, kind: "mention" }),
    [insertAtCaret]
  );
  const pickSkill = useCallback(
    (skill: SkillOption) => insertAtCaret({ kind: "skill", skill }),
    [insertAtCaret]
  );
  const usePrompt = useCallback(
    (prompt: PromptOption) => insertAtCaret({ kind: "prompt", prompt }),
    [insertAtCaret]
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
      choose,
      draftChanged,
      items,
      recallPrompt: promptRecall.recall,
      removeLastAttachment,
      submit,
    };
  });

  // Lists can land while the menu is open (the workspace listing, 065); the
  // plugins wouldn't ask again until the next keystroke. Runs after the
  // layout effect above, so the plugins' own next ask sees the same lists.
  const { refresh: refreshMenus } = menus;
  useEffect(() => {
    refreshMenus(items);
  }, [items, refreshMenus]);

  const placeholderText = shownPlaceholder.current;
  useEffect(() => {
    // Redraw the empty paragraph's placeholder when it changes.
    if (placeholderText !== "" && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta("placeholder", true));
    }
  }, [editor, placeholderText]);

  useEffect(() => {
    editor.setEditable(!disabled, false);
  }, [disabled, editor]);

  // The + menu's "Image" (138): offered when the chosen model can make one
  // (it calls `generate_image`, or draws itself); it starts the message.
  const canMakeImages = useMemo(() => {
    const chosen =
      target?.type === "model"
        ? models.find((option) => option.selector === target.model)
        : undefined;
    return Boolean(
      chosen &&
        (chosen.imageModel || chosen.capabilities.includes("image-output"))
    );
  }, [models, target]);
  const imageStart = t`Make an image of `;
  const startImage = useCallback(() => {
    const current = editor.getText();
    editor.commands.setContent(
      textToDoc(current.trim() === "" ? imageStart : `${imageStart}${current}`),
      { emitUpdate: true }
    );
    editor.commands.focus("end");
  }, [editor, imageStart]);

  // The host filled the composer (138): its text replaces the draft, and
  // the caret waits at the end for the rest of the sentence.
  const fillId = fill?.id;
  const fillText = fill?.text;
  useEffect(() => {
    if (fillId === undefined || fillText === undefined) {
      return;
    }
    editor.commands.setContent(textToDoc(fillText), { emitUpdate: true });
    editor.commands.focus("end");
  }, [editor, fillId, fillText]);

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
          mcpLabel={termLabel(mcp)}
          onChoose={menus.menu.select}
          onHover={menus.hover}
        />
      ) : null}
      <InputGroup
        className={cn(
          look.frame,
          drop.dragging && "border-ring ring-3 ring-ring/50"
        )}
      >
        {files.attachments.length > 0 ? (
          <InputGroupAddon
            align="block-start"
            className="cursor-default flex-col items-start gap-1.5"
          >
            <AttachmentList
              attachments={files.attachments}
              disabled={disabled}
              onRemove={removeAttachment}
            />
          </InputGroupAddon>
        ) : null}
        <EditorContent
          className={cn("w-full min-w-0", disabled && "opacity-50")}
          editor={editor}
        />
        <ComposerFooter
          agents={pickable}
          appearance={appearance}
          attachDisabled={disabled || files.atLimit}
          busy={busy}
          canSubmit={canSubmit}
          chatMode={chatMode}
          disabled={disabled}
          files={fileOptions}
          mcp={mcp}
          models={models}
          onAddFile={addWorkspaceFile}
          onAddSkill={pickSkill}
          onAttach={openFilePicker}
          onMakeImage={canMakeImages ? startImage : undefined}
          onPlanChange={onPlanChange}
          onSteer={onSteer ? steer : undefined}
          onStop={onStop ? stop : undefined}
          onTargetChange={onTargetChange}
          onUsePrompt={usePrompt}
          onVariantChange={onVariantChange}
          onWebSearchChange={onWebSearchChange}
          plan={plan}
          prompts={prompts}
          recentsKey={recentsKey}
          skills={offeredSkills}
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
          Enter sends and Shift+Enter adds a line. Type / or @ for agents,
          skills, prompts, things to make, files and people. Tab moves between a
          prompt's blanks.
        </Trans>{" "}
        {history.length > 0 ? (
          <Trans>
            In an empty message, the up and down arrows bring back what you sent
            before.
          </Trans>
        ) : null}
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
