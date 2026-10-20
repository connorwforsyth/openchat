"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import type {
  LibraryDefinitionInput,
  LibraryItemDetail,
  LibraryKind,
  SkillDefinition,
} from "@workspace/contract/schemas/library";
import {
  ArrowLeftIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  MessageSquareIcon,
  ShareIcon,
  Trash2Icon,
} from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { FieldGroup } from "@workspace/ui/components/field";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type DraftForm,
  definitionToSave,
  type FormIssues,
  formFromDefinition,
  newDefinition,
  sameForm,
  validateDraft,
} from "../form";
import {
  useCreateItem,
  useDeleteItem,
  useDuplicateItem,
  useExportItem,
  useLibraryItem,
  useLibraryList,
  useModels,
  usePublicConfig,
  useUpdateItem,
} from "../hooks";
import { downloadJson, exportFileName } from "../transfer";
import { AgentForm, type Choice, type KnowledgeFile } from "./agent-form";
import { AccessBadge, VersionBadge, VisibilityBadge } from "./badges";
import { ConfirmDelete } from "./confirm-delete";
import { DuplicateNotice } from "./duplicate-notice";
import { EditorFrame } from "./editor-shell";
import { issueAt, TextField } from "./fields";
import { KindTile, useKindLabels } from "./kind";
import { type LinkComponent, usableInChat } from "./library-index";
import { McpForm, McpStatusPanel } from "./mcp-form";
import { PromptForm, PromptPreview } from "./prompt-form";
import { PublishDialog } from "./publish-dialog";
import { ShareDialog } from "./share-dialog";
import { SkillFiles, type SkillFilesProps, SkillForm } from "./skill-form";
import type { TestChatComponent } from "./test-chat";
import { VersionHistory } from "./version-history";

// The builders (D13, 010): one page per item, the form on the left and a
// live panel on the right (the test chat for agents, a preview for
// prompts, the file tree for skills, the connection for MCP servers).
// Saving writes the draft optimistically (D28); publishing, sharing and
// history open dialogs. The page owns routing and whatever talks to runs
// or files, through the props below.

export type BuilderTarget =
  | { readonly id: LibraryItemId; readonly type: "existing" }
  | { readonly kind: LibraryKind; readonly type: "new" };

export interface ItemBuilderProps {
  readonly backHref: string;
  /** Where "Use in chat" goes for a published agent (044). */
  readonly chatHref?: (item: LibraryItemDetail) => string | null;
  /** Agent knowledge: names for attached files, when the page knows them. */
  readonly knowledgeFiles?: readonly KnowledgeFile[];
  readonly link?: LinkComponent;
  /** Agent knowledge: the page uploads and returns files. */
  readonly onAddKnowledge?: () => Promise<readonly KnowledgeFile[]>;
  readonly onCreated?: (item: LibraryItemDetail) => void;
  readonly onDeleted?: () => void;
  readonly onDuplicated?: (item: LibraryItemDetail) => void;
  /** Consumer pins (D13), kept by the page. */
  readonly pins?: {
    readonly get: (id: LibraryItemId) => LibraryVersionId | null;
    readonly set: (
      id: LibraryItemId,
      versionId: LibraryVersionId | null
    ) => void;
  };
  readonly skill?: Pick<SkillFilesProps, "loadFile" | "onTestInSandbox"> & {
    readonly onAddFiles?: () => Promise<SkillDefinition["files"]>;
  };
  readonly target: BuilderTarget;
  readonly testChat?: TestChatComponent;
}

type Dialogs = "share" | "publish" | "history" | "delete" | null;

const PlainLink: LinkComponent = ({ children, className, href }) => (
  <a className={className} href={href}>
    {children}
  </a>
);

export function ItemBuilder(props: ItemBuilderProps) {
  if (props.target.type === "new") {
    return <Builder {...props} detail={null} kind={props.target.kind} />;
  }
  return <ExistingBuilder {...props} id={props.target.id} />;
}

function ExistingBuilder(
  props: ItemBuilderProps & { readonly id: LibraryItemId }
) {
  const item = useLibraryItem(props.id);
  const Link = props.link ?? PlainLink;
  if (item.isPending) {
    return (
      <div aria-busy className="flex h-svh flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-4">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-8">
          <div className="flex gap-4">
            <Skeleton className="size-14 rounded-xl" />
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (item.isError) {
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <Alert className="max-w-md" variant="destructive">
          <AlertTitle>
            <Trans>This item isn't available</Trans>
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <Trans>
              It may have been deleted, or it isn't shared with you.
            </Trans>
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={props.backHref}
            >
              <Trans>Back to the library</Trans>
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  // Keyed by id so opening another item starts from its own draft.
  return (
    <Builder
      {...props}
      detail={item.data}
      key={item.data.id}
      kind={item.data.kind}
    />
  );
}

const formOf = (detail: LibraryItemDetail): DraftForm | null =>
  detail.definition
    ? {
        definition: formFromDefinition(detail.definition),
        description: detail.description,
        name: detail.name,
      }
    : null;

/** Items the caller could attach, across all three tabs. */
const useChoices = (kind: "mcp_server" | "skill"): Choice[] => {
  const mine = useLibraryList({ kind, tab: "mine" });
  const shared = useLibraryList({ kind, tab: "shared" });
  const libraries = useLibraryList({ kind, tab: "libraries" });
  const seen = new Map<string, Choice>();
  for (const list of [mine, shared, libraries]) {
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        seen.set(item.id, { id: item.id, name: item.name });
      }
    }
  }
  return [...seen.values()];
};

const canEditWith = (access: LibraryItemDetail["myAccess"]) =>
  access === "owner" || access === "maintainer" || access === "edit";

/** The draft being edited, whether it differs from what's saved, and saving it. */
const useDraft = (
  detail: LibraryItemDetail | null,
  kind: LibraryKind,
  onCreated: ItemBuilderProps["onCreated"]
) => {
  const { t } = useLingui();
  const update = useUpdateItem((detail?.id ?? "") as LibraryItemId);
  const create = useCreateItem();
  const { mutate: saveDraft } = update;
  const { mutate: createItem } = create;
  const baseline: DraftForm | null = detail
    ? formOf(detail)
    : { definition: newDefinition(kind), description: "", name: "" };
  const [form, setForm] = useState<DraftForm | null>(baseline);
  const [showIssues, setShowIssues] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canEdit = detail ? canEditWith(detail.myAccess) : true;
  const dirty = form !== null && baseline !== null && !sameForm(form, baseline);
  const issues: FormIssues = form ? validateDraft(form) : {};
  const valid = Object.keys(issues).length === 0;

  const save = useCallback(() => {
    if (!(form && canEdit)) {
      return;
    }
    if (!valid) {
      setShowIssues(true);
      return;
    }
    setProblem(null);
    const definition = definitionToSave(form.definition);
    const input = {
      definition,
      description: form.description,
      name: form.name,
    };
    if (!detail) {
      createItem(input, {
        onError: () => setProblem(t`It couldn't be created. Try again.`),
        onSuccess: (created) => onCreated?.(created),
      });
      return;
    }
    saveDraft(input, {
      onError: () =>
        setProblem(t`Your changes weren't saved, so they were undone.`),
    });
    // The typed secret has been sent; it isn't kept on screen.
    setForm({ ...form, definition });
  }, [canEdit, createItem, detail, form, onCreated, saveDraft, t, valid]);

  // The test chat runs the stored draft (033), so a test message saves
  // what's on screen first: an edit then shows up in the very next answer.
  const { mutateAsync: saveDraftNow } = update;
  const saveBeforeTest = useCallback(async (): Promise<boolean> => {
    if (!(detail && form && canEdit && dirty)) {
      return true;
    }
    if (!valid) {
      setShowIssues(true);
      return false;
    }
    setProblem(null);
    const definition = definitionToSave(form.definition);
    setForm({ ...form, definition });
    try {
      await saveDraftNow({
        definition,
        description: form.description,
        name: form.name,
      });
      return true;
    } catch {
      setProblem(t`Your changes weren't saved, so they were undone.`);
      return false;
    }
  }, [canEdit, detail, dirty, form, saveDraftNow, t, valid]);

  return {
    canEdit,
    dirty,
    form,
    issues: showIssues ? issues : {},
    problem,
    save,
    saveBeforeTest,
    saving: update.isPending || create.isPending,
    setForm,
    setProblem,
  };
};

function Builder({
  backHref,
  chatHref,
  detail,
  kind,
  knowledgeFiles,
  link: Link = PlainLink,
  onAddKnowledge,
  onCreated,
  onDeleted,
  onDuplicated,
  pins,
  skill,
  testChat,
}: ItemBuilderProps & {
  readonly detail: LibraryItemDetail | null;
  readonly kind: LibraryKind;
}) {
  const draft = useDraft(detail, kind, onCreated);
  const { form, save, setForm } = draft;
  const [dialog, setDialog] = useState<Dialogs>(null);

  // ⌘S / Ctrl+S saves, as in any editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setDefinition = useCallback(
    (definition: LibraryDefinitionInput) =>
      setForm((current) => (current ? { ...current, definition } : current)),
    [setForm]
  );
  const setName = useCallback(
    (name: string) =>
      setForm((current) => (current ? { ...current, name } : current)),
    [setForm]
  );
  const setDescription = useCallback(
    (description: string) =>
      setForm((current) => (current ? { ...current, description } : current)),
    [setForm]
  );

  const labels = useKindLabels();
  const { t } = useLingui();
  const previewLabels: Record<LibraryKind, string> = {
    agent: t`Preview`,
    mcp_server: t`Connection`,
    preset: t`Preview`,
    prompt: t`Preview`,
    skill: t`Files`,
  };
  const previewLabel = previewLabels[kind];
  const editable = draft.canEdit ? form : null;

  return (
    <EditorFrame
      bar={
        <BuilderHeader
          backHref={backHref}
          chatHref={
            detail && usableInChat(detail) ? (chatHref?.(detail) ?? null) : null
          }
          detail={detail}
          dirty={draft.dirty}
          kind={kind}
          link={Link}
          onDialog={setDialog}
          onDuplicated={onDuplicated}
          onSave={save}
          saving={draft.saving}
          title={form?.name || detail?.name || t`New ${labels[kind]}`}
        />
      }
      preview={
        form ? (
          <KindPanel
            beforeSend={draft.saveBeforeTest}
            definition={form.definition}
            description={form.description}
            detail={detail}
            dirty={draft.dirty}
            name={form.name}
            skill={skill}
            testChat={testChat}
          />
        ) : null
      }
      previewLabel={previewLabel}
    >
      {detail ? <DuplicateNotice id={detail.id} /> : null}

      {draft.problem ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{draft.problem}</AlertDescription>
        </Alert>
      ) : null}

      <IdentitySection
        description={detail?.description ?? ""}
        form={editable}
        issues={draft.issues}
        kind={kind}
        onDescription={setDescription}
        onName={setName}
        title={detail?.name ?? ""}
      />

      {form ? (
        <KindForm
          definition={form.definition}
          detail={detail}
          issues={draft.issues}
          itemName={form.name}
          knowledgeFiles={knowledgeFiles}
          onAddKnowledge={onAddKnowledge}
          onChange={setDefinition}
          readOnly={!draft.canEdit}
          skill={skill}
        />
      ) : (
        <Alert>
          <AlertTitle>
            <Trans>You can use this, but not see how it's set up</Trans>
          </AlertTitle>
          <AlertDescription>
            <Trans>
              It was shared for use only. Ask its owner for view access to see
              its instructions or copy it.
            </Trans>
          </AlertDescription>
        </Alert>
      )}

      {detail ? (
        <BuilderDialogs
          detail={detail}
          dialog={dialog}
          dirty={draft.dirty}
          onDeleted={onDeleted}
          onDialog={setDialog}
          onProblem={draft.setProblem}
          pins={pins}
        />
      ) : null}
    </EditorFrame>
  );
}

function BuilderHeader({
  backHref,
  chatHref,
  detail,
  dirty,
  kind,
  link: Link,
  onDialog,
  onDuplicated,
  onSave,
  saving,
  title,
}: {
  readonly backHref: string;
  readonly chatHref: string | null;
  readonly detail: LibraryItemDetail | null;
  readonly dirty: boolean;
  readonly kind: LibraryKind;
  readonly link: LinkComponent;
  readonly onDialog: (dialog: Dialogs) => void;
  readonly onDuplicated?: (item: LibraryItemDetail) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly title: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-3 md:px-4">
      <Link
        className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
        href={backHref}
      >
        <ArrowLeftIcon className="rtl:-scale-x-100" />
        <span className="sr-only">
          <Trans>Back to the library</Trans>
        </span>
      </Link>
      <KindTile className="size-7" kind={kind} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-medium text-sm">{title}</h1>
        <div className="flex min-w-0 items-center gap-1.5">
          {detail ? (
            <div className="hidden items-center gap-1 sm:flex">
              <VersionBadge item={detail} />
              <VisibilityBadge visibility={detail.visibility} />
              <AccessBadge access={detail.myAccess} />
            </div>
          ) : null}
          <SaveState dirty={dirty} isNew={detail === null} saving={saving} />
        </div>
      </div>
      {chatHref ? (
        <Link
          className={buttonVariants({ size: "sm", variant: "ghost" })}
          href={chatHref}
        >
          <MessageSquareIcon data-icon="inline-start" />
          <span className="hidden md:inline">
            <Trans>Use in chat</Trans>
          </span>
        </Link>
      ) : null}
      <HeaderActions
        detail={detail}
        dirty={dirty}
        kind={kind}
        onDialog={onDialog}
        onDuplicated={onDuplicated}
        onSave={onSave}
        saving={saving}
      />
    </header>
  );
}

function HeaderActions({
  detail,
  dirty,
  kind,
  onDialog,
  onDuplicated,
  onSave,
  saving,
}: {
  readonly detail: LibraryItemDetail | null;
  readonly dirty: boolean;
  readonly kind: LibraryKind;
  readonly onDialog: (dialog: Dialogs) => void;
  readonly onDuplicated?: (item: LibraryItemDetail) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
}) {
  const access = detail?.myAccess ?? "owner";
  const canEdit = canEditWith(access);
  const manage = access === "owner" || access === "maintainer";
  const versioned = kind === "agent" || kind === "prompt" || kind === "skill";
  const openHistory = useCallback(() => onDialog("history"), [onDialog]);
  const openShare = useCallback(() => onDialog("share"), [onDialog]);
  const openPublish = useCallback(() => onDialog("publish"), [onDialog]);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {canEdit ? (
        <Button
          disabled={(detail !== null && !dirty) || saving}
          onClick={onSave}
          size="sm"
          variant={detail ? "outline" : "default"}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {detail ? <Trans>Save draft</Trans> : <Trans>Create</Trans>}
        </Button>
      ) : null}
      {detail ? (
        <>
          {access !== "use" && versioned ? (
            <Button onClick={openHistory} size="sm" variant="ghost">
              <ClockIcon data-icon="inline-start" />
              <span className="sr-only xl:not-sr-only">
                <Trans>History</Trans>
              </span>
            </Button>
          ) : null}
          {manage ? (
            <Button onClick={openShare} size="sm" variant="ghost">
              <ShareIcon data-icon="inline-start" />
              <span className="sr-only xl:not-sr-only">
                <Trans>Share</Trans>
              </span>
            </Button>
          ) : null}
          {canEdit ? (
            <Button onClick={openPublish} size="sm">
              <Trans>Publish</Trans>
            </Button>
          ) : null}
          <MoreActions
            detail={detail}
            onDialog={onDialog}
            onDuplicated={onDuplicated}
          />
        </>
      ) : null}
    </div>
  );
}

/** Who the item is: its tile, name and the one line people see in the library. */
function IdentitySection({
  description,
  form,
  issues,
  kind,
  onDescription,
  onName,
  title,
}: {
  readonly description: string;
  /** `null` when the caller can't edit. */
  readonly form: DraftForm | null;
  readonly issues: FormIssues;
  readonly kind: LibraryKind;
  readonly onDescription: (value: string) => void;
  readonly onName: (value: string) => void;
  readonly title: string;
}) {
  const { t } = useLingui();
  const labels = useKindLabels();
  const kindLabel = labels[kind];
  if (!form) {
    return (
      <div className="flex items-center gap-4">
        <KindTile className="size-14 rounded-xl [&_svg]:size-6" kind={kind} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-medium text-lg">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-4">
      <KindTile className="size-14 rounded-xl [&_svg]:size-6" kind={kind} />
      <FieldGroup className="min-w-0 flex-1 gap-4">
        <TextField
          autoComplete="off"
          issue={issueAt(issues, "name")}
          label={t`Name`}
          name="name"
          onValueChange={onName}
          placeholder={t`Name your ${kindLabel}`}
          value={form.name}
        />
        <TextField
          autoComplete="off"
          description={t`A short line people see in the library and the picker.`}
          issue={issueAt(issues, "description")}
          label={t`Description`}
          name="description"
          onValueChange={onDescription}
          placeholder={t`What it's for`}
          value={form.description}
        />
      </FieldGroup>
    </div>
  );
}

function MoreActions({
  detail,
  onDialog,
  onDuplicated,
}: {
  readonly detail: LibraryItemDetail;
  readonly onDialog: (dialog: Dialogs) => void;
  readonly onDuplicated?: (item: LibraryItemDetail) => void;
}) {
  const { t } = useLingui();
  const duplicate = useDuplicateItem();
  const exportItem = useExportItem();
  const { mutate: duplicateItem } = duplicate;
  const { mutate: exportJson } = exportItem;
  const { id, myAccess, name } = detail;
  const canView = myAccess !== "use";
  const manage = myAccess === "owner" || myAccess === "maintainer";
  const copyToMine = useCallback(
    () => duplicateItem({ id }, { onSuccess: onDuplicated }),
    [duplicateItem, id, onDuplicated]
  );
  const download = useCallback(
    () =>
      exportJson(id, {
        onSuccess: (data) => downloadJson(exportFileName(name), data),
      }),
    [exportJson, id, name]
  );
  const askToDelete = useCallback(() => onDialog("delete"), [onDialog]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label={t`More actions`} size="icon-sm" variant="ghost" />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!canView} onClick={copyToMine}>
            <CopyIcon />
            <Trans>Duplicate to my library</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canView} onClick={download}>
            <DownloadIcon />
            <Trans>Export</Trans>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {manage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={askToDelete} variant="destructive">
                <Trash2Icon />
                <Trans>Delete</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KindForm({
  definition,
  detail,
  issues,
  itemName,
  knowledgeFiles,
  onAddKnowledge,
  onChange,
  readOnly,
  skill,
}: {
  readonly definition: LibraryDefinitionInput;
  readonly detail: LibraryItemDetail | null;
  readonly issues: FormIssues;
  /** The item's display name, to suggest a skill name from. */
  readonly itemName: string;
  readonly knowledgeFiles?: readonly KnowledgeFile[];
  readonly onAddKnowledge?: ItemBuilderProps["onAddKnowledge"];
  readonly onChange: (definition: LibraryDefinitionInput) => void;
  readonly readOnly: boolean;
  readonly skill?: ItemBuilderProps["skill"];
}) {
  const models = useModels();
  const config = usePublicConfig();
  const mcpChoices = useChoices("mcp_server");
  const skillChoices = useChoices("skill");
  switch (definition.kind) {
    case "agent":
      return (
        <AgentForm
          issues={issues}
          knowledgeFiles={knowledgeFiles}
          mcpServers={mcpChoices}
          models={models.data ?? []}
          onAddKnowledge={onAddKnowledge}
          onChange={onChange}
          readOnly={readOnly}
          sandboxProviders={config.data?.sandbox.providers ?? []}
          skills={skillChoices}
          value={definition}
        />
      );
    case "prompt":
      return (
        <PromptForm
          issues={issues}
          onChange={onChange}
          readOnly={readOnly}
          value={definition}
        />
      );
    case "skill":
      return (
        <SkillForm
          issues={issues}
          itemName={itemName}
          onAddFiles={skill?.onAddFiles}
          onChange={onChange}
          readOnly={readOnly}
          value={definition}
        />
      );
    case "mcp_server":
      return (
        <McpForm
          issues={issues}
          onChange={onChange}
          readOnly={readOnly}
          saved={
            detail?.definition?.kind === "mcp_server" ? detail.definition : null
          }
          value={definition}
        />
      );
    case "preset":
      // Presets are edited with settings (024), not here.
      return null;
    default:
      return definition satisfies never;
  }
}

function KindPanel({
  beforeSend,
  definition,
  description,
  detail,
  dirty,
  name,
  skill,
  testChat: TestChat,
}: {
  readonly beforeSend: () => Promise<boolean>;
  readonly definition: LibraryDefinitionInput;
  readonly description: string;
  readonly detail: LibraryItemDetail | null;
  readonly dirty: boolean;
  readonly name: string;
  readonly skill?: ItemBuilderProps["skill"];
  readonly testChat?: TestChatComponent;
}) {
  switch (definition.kind) {
    case "agent": {
      if (!TestChat) {
        return (
          <p className="text-muted-foreground text-sm">
            <Trans>The test chat needs a server to run against.</Trans>
          </p>
        );
      }
      return (
        <TestChat
          beforeSend={beforeSend}
          definition={definition}
          dirty={dirty}
          draft={
            detail?.draftVersionId
              ? { itemId: detail.id, versionId: detail.draftVersionId }
              : null
          }
          identity={{ description, name }}
        />
      );
    }
    case "prompt":
      return <PromptPreview key={definition.template} value={definition} />;
    case "skill":
      return (
        <SkillFiles
          loadFile={skill?.loadFile}
          onTestInSandbox={skill?.onTestInSandbox}
          value={definition}
        />
      );
    case "mcp_server":
      return (
        <McpStatusPanel
          id={detail?.id ?? null}
          usesOAuth={definition.auth.type === "oauth"}
        />
      );
    case "preset":
      return null;
    default:
      return definition satisfies never;
  }
}

function BuilderDialogs({
  detail,
  dialog,
  dirty,
  onDeleted,
  onDialog,
  onProblem,
  pins,
}: {
  readonly detail: LibraryItemDetail;
  readonly dialog: Dialogs;
  readonly dirty: boolean;
  readonly onDeleted?: () => void;
  readonly onDialog: (dialog: Dialogs) => void;
  readonly onProblem: (message: string) => void;
  readonly pins?: ItemBuilderProps["pins"];
}) {
  const remove = useDeleteItem();
  const { mutate: deleteItem } = remove;
  const { id } = detail;
  const toggle = useCallback(
    (which: Exclude<Dialogs, null>) => (open: boolean) =>
      onDialog(open ? which : null),
    [onDialog]
  );
  const [handlers] = useState(() => ({
    delete: toggle("delete"),
    history: toggle("history"),
    publish: toggle("publish"),
    share: toggle("share"),
  }));
  const pin = useCallback(
    (versionId: LibraryVersionId | null) => pins?.set(id, versionId),
    [id, pins]
  );
  const confirmDelete = useCallback(
    () => deleteItem(id, { onSuccess: onDeleted }),
    [deleteItem, id, onDeleted]
  );
  return (
    <>
      <ShareDialog
        item={detail}
        onOpenChange={handlers.share}
        open={dialog === "share"}
      />
      <PublishDialog
        dirty={dirty}
        item={detail}
        onOpenChange={handlers.publish}
        onProblem={onProblem}
        open={dialog === "publish"}
      />
      <VersionHistory
        item={detail}
        onOpenChange={handlers.history}
        onPin={pins ? pin : undefined}
        open={dialog === "history"}
        pinnedVersionId={pins?.get(id) ?? null}
      />
      <ConfirmDelete
        name={detail.name}
        onConfirm={confirmDelete}
        onOpenChange={handlers.delete}
        open={dialog === "delete"}
      />
    </>
  );
}

function SaveState({
  dirty,
  isNew,
  saving,
}: {
  readonly dirty: boolean;
  readonly isNew: boolean;
  readonly saving: boolean;
}) {
  let text: ReactNode = null;
  if (saving) {
    text = <Trans>Saving…</Trans>;
  } else if (dirty) {
    text = <Trans>Unsaved changes</Trans>;
  } else if (isNew) {
    text = <Trans>Not created yet</Trans>;
  } else {
    text = <Trans>Draft saved</Trans>;
  }
  return (
    <span aria-live="polite" className="truncate text-muted-foreground text-xs">
      {text}
    </span>
  );
}
