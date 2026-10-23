"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import {
  isVersionedLibraryKind,
  type LibraryDefinitionInput,
  type LibraryItemDetail,
  type LibraryKind,
  type SkillDefinition,
} from "@workspace/contract/schemas/library";
import {
  ArrowLeftIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  LockIcon,
  MessageSquareIcon,
  ShareIcon,
  Trash2Icon,
  UsersIcon,
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
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  type ChangeEvent,
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
  newSkillMd,
  sameForm,
  validateDraft,
} from "../form";
import {
  useCreateItem,
  useDeleteItem,
  useDuplicateItem,
  useExportItem,
  useFetchItem,
  useLibraryItem,
  useLibraryList,
  useModels,
  usePublicConfig,
  useUpdateItem,
} from "../hooks";
import { type PublishState, publishStateOf } from "../publish-state";
import { downloadJson, exportFileName } from "../transfer";
import { AgentForm, type Choice, type KnowledgeFile } from "./agent-form";
import { AccessBadge, VersionBadge, VisibilityBadge } from "./badges";
import { ConfirmDelete } from "./confirm-delete";
import { DuplicateNotice } from "./duplicate-notice";
import { KindTile, useKindLabels } from "./kind";
import { type LinkComponent, usableInChat } from "./library-index";
import { McpForm, McpStatusPanel } from "./mcp-form";
import { PromptForm, PromptPreview } from "./prompt-form";
import { PublishDialog } from "./publish-dialog";
import { ShareDialog } from "./share-dialog";
import { SkillFiles, type SkillFilesProps, SkillForm } from "./skill-form";
import type { NewSkill } from "./skills-section";
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
  if (item.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (item.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          <Trans>This item isn't available</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>It may have been deleted, or it isn't shared with you.</Trans>
        </AlertDescription>
      </Alert>
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

/** Items the caller could attach or insert, across all three tabs. */
const useChoices = (kind: "mcp_server" | "prompt" | "skill"): Choice[] => {
  const mine = useLibraryList({ kind, tab: "mine" });
  const shared = useLibraryList({ kind, tab: "shared" });
  const libraries = useLibraryList({ kind, tab: "libraries" });
  const seen = new Map<string, Choice>();
  for (const list of [mine, shared, libraries]) {
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        seen.set(item.id, {
          description: item.description,
          id: item.id,
          name: item.name,
          published: item.latestVersionNumber !== null,
        });
      }
    }
  }
  return [...seen.values()];
};

/** A prompt's template for a `/` menu: the latest version, else the draft; `null` when neither can be read. */
const useLoadPrompt = () => {
  const fetchItem = useFetchItem();
  return useCallback(
    async (id: LibraryItemId): Promise<string | null> => {
      try {
        const latest = await fetchItem(id, "latest");
        const item = latest.definition ? latest : await fetchItem(id, "draft");
        return item.definition?.kind === "prompt"
          ? item.definition.template
          : null;
      } catch {
        return null;
      }
    },
    [fetchItem]
  );
};

/** "Write a skill": saves it as the writer's own draft. */
const useCreateSkill = () => {
  const { mutateAsync } = useCreateItem();
  return useCallback(
    async (skill: NewSkill): Promise<Choice | null> => {
      try {
        const created = await mutateAsync({
          definition: { files: [], kind: "skill", skillMd: newSkillMd(skill) },
          description: skill.description,
          name: skill.name,
        });
        return {
          description: created.description,
          id: created.id,
          name: created.name,
          published: false,
        };
      } catch {
        return null;
      }
    },
    [mutateAsync]
  );
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

  const [createPending, setCreatePending] = useState(false);
  const createInFlight = useRef(false);
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
      // Held from the first click until the page moves to the new item, so
      // a second click can't make a second one; only a failure lets go.
      // biome-ignore lint/suspicious/noUnnecessaryConditions: repeated save calls read the previous call's ref write before React renders.
      if (createInFlight.current) {
        return;
      }
      createInFlight.current = true;
      setCreatePending(true);
      createItem(input, {
        onError: () => {
          createInFlight.current = false;
          setCreatePending(false);
          setProblem(t`It couldn't be created. Try again.`);
        },
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
    saving: update.isPending || create.isPending || createPending,
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
  const openPublish = useCallback(() => setDialog("publish"), []);

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
    (event: ChangeEvent<HTMLInputElement>) => {
      const name = event.currentTarget.value;
      setForm((current) => (current ? { ...current, name } : current));
    },
    [setForm]
  );
  const setDescription = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const description = event.currentTarget.value;
      setForm((current) => (current ? { ...current, description } : current));
    },
    [setForm]
  );

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <BuilderHeader
        backHref={backHref}
        chatHref={
          detail && usableInChat(detail) ? (chatHref?.(detail) ?? null) : null
        }
        detail={detail}
        dirty={draft.dirty}
        form={draft.canEdit ? form : null}
        kind={kind}
        link={Link}
        nameInvalid={Boolean(draft.issues.name)}
        onDescription={setDescription}
        onDialog={setDialog}
        onDuplicated={onDuplicated}
        onName={setName}
        onSave={save}
        saving={draft.saving}
      />

      {draft.canEdit ? (
        <PublishStrip
          onPublish={detail ? openPublish : undefined}
          state={publishStateOf(kind, detail)}
        />
      ) : null}

      {detail ? <DuplicateNotice id={detail.id} /> : null}

      {draft.problem ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{draft.problem}</AlertDescription>
        </Alert>
      ) : null}

      {form ? (
        <div className="grid min-h-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <KindForm
              definition={form.definition}
              detail={detail}
              issues={draft.issues}
              knowledgeFiles={knowledgeFiles}
              onAddKnowledge={onAddKnowledge}
              onChange={setDefinition}
              readOnly={!draft.canEdit}
              skill={skill}
            />
          </div>
          <aside className="min-w-0 lg:sticky lg:top-6 lg:h-[calc(100svh-10rem)]">
            <KindPanel
              beforeSend={draft.saveBeforeTest}
              definition={form.definition}
              detail={detail}
              dirty={draft.dirty}
              onCreate={detail ? undefined : save}
              skill={skill}
              testChat={testChat}
            />
          </aside>
        </div>
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
    </div>
  );
}

function BuilderHeader({
  backHref,
  chatHref,
  detail,
  dirty,
  form,
  kind,
  link: Link,
  nameInvalid,
  onDescription,
  onDialog,
  onDuplicated,
  onName,
  onSave,
  saving,
}: {
  readonly backHref: string;
  readonly chatHref: string | null;
  readonly detail: LibraryItemDetail | null;
  readonly dirty: boolean;
  /** `null` when the caller can't edit. */
  readonly form: DraftForm | null;
  readonly kind: LibraryKind;
  readonly link: LinkComponent;
  readonly nameInvalid: boolean;
  readonly onDescription: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDialog: (dialog: Dialogs) => void;
  readonly onDuplicated?: (item: LibraryItemDetail) => void;
  readonly onName: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
}) {
  const labels = useKindLabels();
  const kindLabel = labels[kind];
  const title = form?.name || detail?.name || kindLabel;

  return (
    <header className="flex flex-wrap items-start gap-3">
      <Link
        className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
        href={backHref}
      >
        <ArrowLeftIcon />
        <span className="sr-only">
          <Trans>Back to the library</Trans>
        </span>
      </Link>
      <KindTile kind={kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Titles
          description={detail?.description ?? ""}
          form={form}
          kindLabel={kindLabel}
          nameInvalid={nameInvalid}
          onDescription={onDescription}
          onName={onName}
          title={title}
        />
        {detail ? (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <VersionBadge item={detail} />
            <VisibilityBadge visibility={detail.visibility} />
            <AccessBadge access={detail.myAccess} />
          </div>
        ) : null}
      </div>
      {chatHref ? (
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={chatHref}
        >
          <MessageSquareIcon data-icon="inline-start" />
          <Trans>Use in chat</Trans>
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
  const versioned = isVersionedLibraryKind(kind);
  const openHistory = useCallback(() => onDialog("history"), [onDialog]);
  const openShare = useCallback(() => onDialog("share"), [onDialog]);
  const openPublish = useCallback(() => onDialog("publish"), [onDialog]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SaveState dirty={dirty} saving={saving} />
      {canEdit ? (
        <Button
          disabled={(detail !== null && !dirty) || saving}
          onClick={onSave}
          variant={detail ? "outline" : "default"}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {detail ? <Trans>Save draft</Trans> : <Trans>Create</Trans>}
        </Button>
      ) : null}
      {detail ? (
        <>
          {access !== "use" && versioned ? (
            <Button onClick={openHistory} variant="ghost">
              <ClockIcon data-icon="inline-start" />
              <Trans>History</Trans>
            </Button>
          ) : null}
          {manage ? (
            <Button onClick={openShare} variant="ghost">
              <ShareIcon data-icon="inline-start" />
              <Trans>Share</Trans>
            </Button>
          ) : null}
          {/* Versioned kinds publish from the strip that says where they stand. */}
          {canEdit && !versioned ? (
            <Button onClick={openPublish}>
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

function Titles({
  description,
  form,
  kindLabel,
  nameInvalid,
  onDescription,
  onName,
  title,
}: {
  readonly description: string;
  readonly form: DraftForm | null;
  readonly kindLabel: string;
  readonly nameInvalid: boolean;
  readonly onDescription: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onName: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly title: string;
}) {
  const { t } = useLingui();
  if (!form) {
    return (
      <>
        <h1 className="truncate font-medium text-lg">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </>
    );
  }
  return (
    <>
      <Input
        aria-invalid={nameInvalid || undefined}
        aria-label={t`Name`}
        className="h-8 max-w-md font-medium"
        onChange={onName}
        placeholder={t`Name your ${kindLabel}`}
        value={form.name}
      />
      <Input
        aria-label={t`Description`}
        className="h-7 max-w-md text-muted-foreground text-sm"
        onChange={onDescription}
        placeholder={t`What it's for`}
        value={form.description}
      />
    </>
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
          <Button aria-label={t`More actions`} size="icon" variant="ghost" />
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
  knowledgeFiles,
  onAddKnowledge,
  onChange,
  readOnly,
  skill,
}: {
  readonly definition: LibraryDefinitionInput;
  readonly detail: LibraryItemDetail | null;
  readonly issues: FormIssues;
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
  // A prompt doesn't offer itself.
  const promptChoices = useChoices("prompt").filter(
    (prompt) => prompt.id !== detail?.id
  );
  const loadPrompt = useLoadPrompt();
  const createSkill = useCreateSkill();
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
          onCreateSkill={createSkill}
          onLoadPrompt={loadPrompt}
          prompts={promptChoices}
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
          onLoadPrompt={loadPrompt}
          prompts={promptChoices}
          readOnly={readOnly}
          value={definition}
        />
      );
    case "skill":
      return (
        <SkillForm
          issues={issues}
          onAddFiles={skill?.onAddFiles}
          onChange={onChange}
          onLoadPrompt={loadPrompt}
          prompts={promptChoices}
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
  detail,
  dirty,
  onCreate,
  skill,
  testChat: TestChat,
}: {
  readonly beforeSend: () => Promise<boolean>;
  readonly definition: LibraryDefinitionInput;
  readonly detail: LibraryItemDetail | null;
  readonly dirty: boolean;
  /** Creates the item, for a new agent's "Save draft and test". */
  readonly onCreate?: () => void;
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
          onCreate={onCreate}
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

function PublishStrip({
  onPublish,
  state,
}: {
  /** Opens the publish dialog; absent before the item exists. */
  readonly onPublish?: () => void;
  readonly state: PublishState | null;
}) {
  if (state === null) {
    return null;
  }
  let icon: ReactNode = <UsersIcon aria-hidden className="size-4 shrink-0" />;
  let text: ReactNode;
  switch (state.type) {
    case "new":
      icon = <LockIcon aria-hidden className="size-4 shrink-0" />;
      text = <Trans>New · Create it to save a draft only you can see.</Trans>;
      break;
    case "draft":
      if (state.shared) {
        text = (
          <Trans>
            Draft · Shared with people you chose. Publish to share it with your
            team.
          </Trans>
        );
      } else {
        icon = <LockIcon aria-hidden className="size-4 shrink-0" />;
        text = (
          <Trans>
            Draft · Only you can see it. Publish to share it with your team.
          </Trans>
        );
      }
      break;
    case "published": {
      const { version } = state;
      text = (
        <Trans>
          Published v{version} · Your team uses this version. Edits stay in your
          draft until you publish again.
        </Trans>
      );
      break;
    }
    default:
      return state satisfies never;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm"
      data-slot="publish-state"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
        {icon}
        <span>{text}</span>
      </span>
      {onPublish ? (
        <Button onClick={onPublish} size="sm">
          <Trans>Publish</Trans>
        </Button>
      ) : null}
    </div>
  );
}

function SaveState({
  dirty,
  saving,
}: {
  readonly dirty: boolean;
  readonly saving: boolean;
}) {
  let text: ReactNode = null;
  if (saving) {
    text = <Trans>Saving…</Trans>;
  } else if (dirty) {
    text = <Trans>Unsaved changes</Trans>;
  }
  return (
    <span aria-live="polite" className="text-muted-foreground text-xs">
      {text}
    </span>
  );
}
