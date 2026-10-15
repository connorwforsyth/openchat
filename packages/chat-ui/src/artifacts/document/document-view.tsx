"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentToMarkdown } from "@workspace/artifacts-kit/kinds/document/markdown";
import {
  type Document,
  documentContentSchema,
} from "@workspace/artifacts-kit/kinds/document/schema";
import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactAccess,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import { formatDate } from "@workspace/i18n/format";
import {
  AtSignIcon,
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PencilIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ArtifactSelection } from "../artifact-view";
import type { PlanEditing } from "../plan-editor";
import { DocumentToolbar } from "./document-toolbar";
import { exportDocx, exportMarkdown, printDocument } from "./export";
import { documentExtensions } from "./extensions";
import {
  type DocumentSaveState,
  type SaveDocumentVersion,
  useDocumentSave,
} from "./use-document-save";

// A Document artifact (126) as a page: after Claude's document view, a
// title bar (the title, its versions, whether edits are saved, Export, and
// whatever the host adds: Chat and Share on the artifact's own page), the
// toolbar, then the page itself with a serif title, chips for the date and
// the author, and the rich text. A person's edit saves a new version after
// a pause in typing. Older versions open read-only, with Restore.

export interface DocumentViewProps {
  /** The caller's access: an owner or editor edits; anyone else reads. `null` while unknown. */
  readonly access: ArtifactAccess | null;
  /** The host's buttons for the title bar (Chat, Share, ⋯). */
  readonly actions?: ReactNode;
  readonly artifact: Artifact;
  /** Who it belongs to, for the author chip. */
  readonly authorName?: string;
  /** A plan being edited (106): Approve and Cancel under the page. */
  readonly editing?: PlanEditing | null;
  /** Frames the title bar in the host's row (the panel adds Close). */
  readonly header: (content: ReactNode) => ReactNode;
  readonly onSave: SaveDocumentVersion;
  readonly onSelect: (selection: ArtifactSelection) => void;
  /** The version shown; omitted, the latest. */
  readonly versionId?: ArtifactVersionId;
  /** Every version, oldest first. */
  readonly versions: readonly ArtifactVersion[];
}

const readDocument = (content: string): Document | null => {
  const parsed = documentContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
};

const PLAN_PREFIX = /^plan:\s*/i;
const SPACES = /\s+/g;
const plainTitle = (text: string) =>
  text.replace(PLAN_PREFIX, "").replace(SPACES, " ").trim().toLowerCase();

/** Whether the document's first block is a level-one heading reading `title`. */
const opensWithTitle = (document: Document, title: string): boolean => {
  const [first] = document.content;
  if (first?.type !== "heading" || first.attrs.level !== 1) {
    return false;
  }
  const text = (first.content ?? [])
    .map((node) => (node.type === "text" ? node.text : " "))
    .join("");
  return plainTitle(text) === plainTitle(title);
};

/** The editor's document, as a version stores it. */
const storedOf = (editor: Editor): string => JSON.stringify(editor.getJSON());

export function DocumentView({
  access,
  actions,
  artifact,
  authorName,
  editing = null,
  header,
  onSave,
  onSelect,
  versionId,
  versions,
}: DocumentViewProps) {
  const latest = versions.at(-1);
  // A version picked while it was the latest (an artifact card, the pager's
  // last step) means "the document": it follows new versions as they land,
  // so the editor stays the editor. An older one stays put.
  const [pick, setPick] = useState(() => ({
    follows: versionId === undefined || versionId === latest?.id,
    versionId,
  }));
  if (pick.versionId !== versionId) {
    setPick({
      follows: versionId === undefined || versionId === latest?.id,
      versionId,
    });
  }
  const index = Math.max(
    0,
    versionId && !pick.follows
      ? versions.findIndex((each) => each.id === versionId)
      : versions.length - 1
  );
  const shown = versions[index] ?? latest;
  if (!(latest && shown)) {
    return null;
  }
  const isLatest = shown.id === latest.id;
  const canEdit = access === "owner" || access === "editor";
  return (
    <LatestDocument
      access={access}
      actions={actions}
      artifact={artifact}
      authorName={authorName}
      canEdit={canEdit && isLatest}
      editing={editing?.artifactId === artifact.id ? editing : null}
      header={header}
      index={index}
      // An older version is its own read-only page; the latest stays
      // mounted while it's edited, so saving never resets the cursor.
      key={isLatest ? "latest" : shown.id}
      latest={latest}
      mayEdit={canEdit}
      onSave={onSave}
      onSelect={onSelect}
      shown={shown}
      versions={versions}
    />
  );
}

function LatestDocument({
  actions,
  artifact,
  authorName,
  canEdit,
  editing,
  header,
  index,
  latest,
  mayEdit,
  onSave,
  onSelect,
  shown,
  versions,
}: Omit<DocumentViewProps, "versionId"> & {
  /** Edits the version shown: it's the latest, and the caller may. */
  readonly canEdit: boolean;
  /** May edit the artifact at all (owner or editor): can restore an older version. */
  readonly mayEdit: boolean;
  readonly index: number;
  readonly latest: ArtifactVersion;
  readonly shown: ArtifactVersion;
}) {
  const { i18n, t } = useLingui();
  const initial = useMemo(() => readDocument(shown.content), [shown.content]);
  // A document that opens with its own title as a heading (the model often
  // writes one) shows it once.
  const titled = useMemo(
    () => (initial ? opensWithTitle(initial, artifact.title) : false),
    [artifact.title, initial]
  );
  const save = useDocumentSave({
    baseVersionId: latest.id,
    save: onSave,
  });
  const { change } = save;
  // Made once, so the editor isn't handed new options (and re-set) on
  // every render.
  const label = t`Document`;
  const placeholder = t`Start writing…`;
  const extensions = useMemo(
    () => documentExtensions(placeholder),
    [placeholder]
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        class: "outline-none",
        "data-slot": "document-editor",
        role: "textbox",
      },
    }),
    [label]
  );
  const editor = useEditor(
    {
      content: initial ?? undefined,
      editable: canEdit,
      editorProps,
      extensions,
      immediatelyRender: false,
      onUpdate: ({ editor: updated, transaction }) => {
        if (transaction.docChanged) {
          change(storedOf(updated));
        }
      },
      shouldRerenderOnTransaction: false,
    },
    []
  );
  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [canEdit, editor]);

  // A version made elsewhere (the model, another editor) shows at once when
  // nothing here waits to be saved; otherwise the save says there's a
  // conflict and the person picks.
  const latestShown = useRef(latest.id);
  const { saved: isMine, state } = save;
  useEffect(() => {
    if (
      !editor ||
      latestShown.current === latest.id ||
      shown.id !== latest.id
    ) {
      return;
    }
    latestShown.current = latest.id;
    if (isMine(latest.id) || state !== "saved") {
      return;
    }
    const next = readDocument(latest.content);
    if (next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, isMine, latest, shown.id, state]);

  const loadLatest = useCallback(() => {
    const next = readDocument(latest.content);
    if (editor && next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
    save.reset(latest.id);
  }, [editor, latest, save]);
  const keepMine = useCallback(
    () => save.keepMine(latest.id),
    [latest.id, save]
  );
  const retry = useCallback(() => {
    save.flush().catch(() => undefined);
  }, [save]);

  const restore = useCallback(() => {
    onSave({ baseVersionId: latest.id, content: shown.content })
      .then((version) =>
        onSelect({ artifactId: artifact.id, versionId: version.id })
      )
      .catch(() => undefined);
  }, [artifact.id, latest.id, onSave, onSelect, shown.content]);

  const current = useCallback(
    (): Document | null =>
      editor ? readDocument(storedOf(editor)) : readDocument(shown.content),
    [editor, shown.content]
  );
  const meta = [
    formatDate(new Date(shown.createdAt), i18n.locale, {
      dateStyle: "long",
    }),
    authorName,
  ]
    .filter(Boolean)
    .join(" · ");
  const exports = {
    docx: () => {
      const document = current();
      if (document) {
        exportDocx(document, artifact.title).catch(() => undefined);
      }
    },
    markdown: () => {
      const document = current();
      if (document) {
        exportMarkdown(document, artifact.title);
      }
    },
    pdf: () => {
      const document = current();
      if (document) {
        printDocument(document, {
          lang: i18n.locale,
          meta,
          title: artifact.title,
        });
      }
    },
  };

  const isLatest = shown.id === latest.id;
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-artifact-kind="document"
    >
      {header(
        <TitleBar
          actions={actions}
          artifact={artifact}
          exports={exports}
          index={index}
          onSelect={onSelect}
          status={
            isLatest ? (
              <SaveStatus
                canEdit={canEdit}
                onKeepMine={keepMine}
                onLoadLatest={loadLatest}
                onRetry={retry}
                state={state}
              />
            ) : (
              <OlderVersion
                canRestore={mayEdit}
                number={shown.number}
                onRestore={restore}
              />
            )
          }
          versions={versions}
        />
      )}
      {editor && canEdit ? <DocumentToolbar editor={editor} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-10 sm:px-10">
          <header className="flex flex-col gap-3">
            {titled ? null : (
              <h1 className="text-balance font-serif text-3xl leading-tight sm:text-4xl">
                {artifact.title}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Chip icon={<CalendarIcon aria-hidden />}>
                {formatDate(new Date(shown.createdAt), i18n.locale, {
                  dateStyle: "medium",
                })}
              </Chip>
              {authorName ? (
                <Chip icon={<AtSignIcon aria-hidden />}>{authorName}</Chip>
              ) : null}
              {shown.editedBy ? (
                <Chip icon={<PencilIcon aria-hidden />}>
                  <Trans>Edited by hand</Trans>
                </Chip>
              ) : null}
            </div>
          </header>
          {initial === null ? (
            <p className="text-destructive text-sm" role="alert">
              <Trans>This version couldn't be read as a document.</Trans>
            </p>
          ) : (
            <EditorContent className={DOCUMENT_TEXT} editor={editor} />
          )}
        </article>
      </div>
      {editing ? (
        <PlanFooter
          busy={editing.busy ?? false}
          current={current}
          flush={save.flush}
          onApprove={editing.onApprove}
          onCancel={editing.onCancel}
        />
      ) : null}
    </div>
  );
}

/**
 * The rich text's look, in the theme's tokens: a readable serif-headed page.
 * The editor's own nodes (task items, tables, the placeholder) are styled
 * here too, since ProseMirror renders them as plain elements.
 */
const DOCUMENT_TEXT = cn(
  "text-base leading-relaxed",
  "[&_.ProseMirror]:min-h-48 [&_.ProseMirror]:outline-none",
  "[&_.ProseMirror>*+*]:mt-3",
  // Headings take more room above them than the generic gap (more specific).
  "[&_.ProseMirror>*+h1]:mt-10 [&_.ProseMirror>*+h2]:mt-8 [&_.ProseMirror>*+h3]:mt-6 [&_.ProseMirror>*+h4]:mt-5",
  "[&_h1]:font-serif [&_h1]:text-3xl [&_h1]:leading-tight",
  "[&_h2]:font-serif [&_h2]:text-2xl [&_h2]:leading-snug",
  "[&_h3]:font-semibold [&_h3]:text-xl",
  "[&_h4]:font-semibold [&_h4]:text-lg",
  "[&_h5]:font-semibold [&_h6]:font-semibold [&_h6]:text-muted-foreground",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_li]:my-1 [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:ps-1",
  "[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2",
  "[&_li[data-type=taskItem]>div]:flex-1 [&_li[data-type=taskItem]>label]:mt-1",
  "[&_li[data-checked=true]>div]:text-muted-foreground [&_li[data-checked=true]>div]:line-through",
  "[&_blockquote]:border-border [&_blockquote]:border-s-2 [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em]",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-ring [&_img]:max-w-full [&_img]:rounded-lg",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-start [&_th]:align-top [&_th]:font-medium",
  "[&_.selectedCell]:bg-accent [&_td>*+*]:mt-2 [&_th>*+*]:mt-2",
  "[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-start [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
);

function Chip({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground text-xs [&_svg]:size-3.5">
      {icon}
      {children}
    </span>
  );
}

function TitleBar({
  actions,
  artifact,
  exports,
  index,
  onSelect,
  status,
  versions,
}: {
  readonly actions?: ReactNode;
  readonly artifact: Artifact;
  readonly exports: Readonly<Record<"docx" | "markdown" | "pdf", () => void>>;
  readonly index: number;
  readonly onSelect: (selection: ArtifactSelection) => void;
  readonly status: ReactNode;
  readonly versions: readonly ArtifactVersion[];
}) {
  const { t } = useLingui();
  const step = useCallback(
    (delta: -1 | 1) => {
      const target = versions[index + delta];
      if (target) {
        onSelect({ artifactId: artifact.id, versionId: target.id });
      }
    },
    [artifact.id, index, onSelect, versions]
  );
  const older = useCallback(() => step(-1), [step]);
  const newer = useCallback(() => step(1), [step]);
  const number = versions[index]?.number ?? index + 1;
  const total = versions.length;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <h2
        className="min-w-0 flex-1 truncate font-medium text-sm"
        title={artifact.title}
      >
        {artifact.title}
      </h2>
      {total > 1 ? (
        // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields.
        <div
          aria-label={t`Versions`}
          className="hidden shrink-0 items-center sm:flex"
          role="group"
        >
          <Button
            aria-label={t`Older version`}
            disabled={index === 0}
            onClick={older}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <span
            aria-live="polite"
            className="min-w-14 text-center text-muted-foreground text-xs tabular-nums"
          >
            <Trans>
              v{number} of {total}
            </Trans>
          </span>
          <Button
            aria-label={t`Newer version`}
            disabled={index >= total - 1}
            onClick={newer}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {status}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Export`}
              size="sm"
              title={t`Export`}
              variant="ghost"
            />
          }
        >
          <DownloadIcon aria-hidden data-icon="inline-start" />
          <span className="hidden md:inline">
            <Trans>Export</Trans>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={exports.markdown}>
              <Trans>Markdown (.md)</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exports.docx}>
              <Trans>Word (.docx)</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exports.pdf}>
              <Trans>PDF (print)…</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {actions}
    </div>
  );
}

export function SaveStatus({
  canEdit,
  onKeepMine,
  onLoadLatest,
  onRetry,
  state,
}: {
  readonly canEdit: boolean;
  readonly onKeepMine: () => void;
  readonly onLoadLatest: () => void;
  readonly onRetry: () => void;
  readonly state: DocumentSaveState;
}) {
  const quiet = "shrink-0 text-muted-foreground text-xs";
  if (!canEdit) {
    return (
      <span className={quiet}>
        <Trans>Read only</Trans>
      </span>
    );
  }
  switch (state) {
    case "saved":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <CheckIcon aria-hidden className="size-3.5" />
          <span className="sr-only sm:not-sr-only">
            <Trans>Saved</Trans>
          </span>
        </output>
      );
    case "unsaved":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <CircleIcon aria-hidden className="size-2 fill-current" />
          <span className="sr-only sm:not-sr-only">
            <Trans>Edited</Trans>
          </span>
        </output>
      );
    case "saving":
      return (
        <output
          className={cn(quiet, "inline-flex items-center gap-1")}
          data-save-state={state}
        >
          <LoaderCircleIcon
            aria-hidden
            className="size-3.5 motion-safe:animate-spin"
          />
          <span className="sr-only sm:not-sr-only">
            <Trans>Saving…</Trans>
          </span>
        </output>
      );
    case "error":
      return (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-destructive text-xs"
          data-save-state={state}
          role="alert"
        >
          <CircleAlertIcon aria-hidden className="size-3.5" />
          <Trans>Couldn't save</Trans>
          <Button onClick={onRetry} size="xs" variant="ghost">
            <Trans>Retry</Trans>
          </Button>
        </span>
      );
    case "conflict":
      return (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs"
          data-save-state={state}
          role="alert"
        >
          <CircleAlertIcon aria-hidden className="size-3.5 text-destructive" />
          <Trans>Changed elsewhere</Trans>
          <Button onClick={onLoadLatest} size="xs" variant="ghost">
            <Trans>Load theirs</Trans>
          </Button>
          <Button onClick={onKeepMine} size="xs" variant="outline">
            <Trans>Keep mine</Trans>
          </Button>
        </span>
      );
    default:
      return state satisfies never;
  }
}

export function OlderVersion({
  canRestore,
  number,
  onRestore,
}: {
  readonly canRestore: boolean;
  readonly number: number;
  readonly onRestore: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <Trans>Version {number}, read only</Trans>
      {canRestore ? (
        <Button onClick={onRestore} size="xs" variant="outline">
          <Trans>Restore</Trans>
        </Button>
      ) : null}
    </span>
  );
}

function PlanFooter({
  busy,
  current,
  flush,
  onApprove,
  onCancel,
}: {
  readonly busy: boolean;
  readonly current: () => Document | null;
  readonly flush: () => Promise<boolean>;
  readonly onApprove: (content: string | undefined) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useLingui();
  const [approving, setApproving] = useState(false);
  const approve = useCallback(async () => {
    setApproving(true);
    // Edits are saved as versions as they're made; the approval names the
    // latest. If saving can't (a chat member who can't edit the artifact),
    // the plan goes with the approval instead, as Markdown.
    const saved = await flush().catch(() => false);
    const document = saved ? null : current();
    setApproving(false);
    onApprove(document ? documentToMarkdown(document) : undefined);
  }, [current, flush, onApprove]);
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
      <p className="me-auto text-muted-foreground text-xs">
        <Trans>
          Your edits are saved as you go. Approve to build this plan.
        </Trans>
      </p>
      <Button onClick={onCancel} size="sm" type="button" variant="ghost">
        <Trans>Cancel</Trans>
      </Button>
      <Button
        aria-label={t`Approve the plan`}
        disabled={busy || approving}
        onClick={approve}
        size="sm"
        type="button"
      >
        <CheckIcon aria-hidden />
        <Trans>Approve</Trans>
      </Button>
    </div>
  );
}
