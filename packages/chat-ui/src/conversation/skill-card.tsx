"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  createSkillInputSchema,
  publishSkillInputSchema,
  type SkillAuthoringTool,
  type SkillLibrary,
  type SkillRef,
  updateSkillInputSchema,
} from "@workspace/ai/tools/registry/skill-authoring";
import type { JsonValue } from "@workspace/contract/schemas/common";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  SparklesIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { buttonVariants } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { useMemo } from "react";

import { versionEdit } from "../model/artifacts";
import type { ToolDetail } from "../model/tool-summary";
import { useConversationActions } from "./actions";
import { LazyDiffView } from "./lazy";

// The skill tools in the transcript (128). A saved or published skill is a
// card: its name, which version and whether it's live, the library it's in,
// and "Open in Library"; an edit also shows what it changed in SKILL.md,
// with the same diff as an artifact's versions. While a call waits, the
// approval card says what it will do, and for a publish, exactly where.

type SkillResult = Extract<ToolDetail, { kind: "skill" }>;

function LibraryName({ library }: { readonly library: SkillLibrary }) {
  const { name } = library.type === "personal" ? { name: "" } : library;
  switch (library.type) {
    case "personal":
      return <Trans>your library</Trans>;
    case "user":
      return <Trans>{name}'s library</Trans>;
    case "team":
      return <Trans>the {name} team library</Trans>;
    case "org":
      return <Trans>the {name} org library</Trans>;
    default:
      return library satisfies never;
  }
}

function StateBadge({ skill }: { readonly skill: SkillRef }) {
  const { version } = skill;
  return skill.state === "published" ? (
    <Badge variant="secondary">
      <Trans>Published · v{version}</Trans>
    </Badge>
  ) : (
    <Badge variant="outline">
      <Trans>Draft · v{version}</Trans>
    </Badge>
  );
}

function Action({ tool }: { readonly tool: SkillAuthoringTool }) {
  switch (tool) {
    case "create_skill":
      return <Trans>Created a skill</Trans>;
    case "update_skill":
      return <Trans>Changed a skill</Trans>;
    case "publish_skill":
      return <Trans>Published a skill</Trans>;
    default:
      return tool satisfies never;
  }
}

/** What an edit changed in SKILL.md, behind a toggle; `null` when nothing did. */
function SkillChanges({ edit }: { readonly edit: ProposedEdit | null }) {
  if (!edit) {
    return (
      <p className="text-muted-foreground text-xs">
        <Trans>SKILL.md is unchanged.</Trans>
      </p>
    );
  }
  return (
    <Collapsible className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex w-fit items-center gap-1 rounded-md text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <Trans>Changes to SKILL.md</Trans>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 transition-transform duration-(--motion-fast) ease-motion-out group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      {/* Opens at once: D28 never animates height. */}
      <CollapsibleContent>
        <LazyDiffView edit={edit} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A skill a tool saved or published: what it is now, and a way to open it. */
export function SkillCard({ detail }: { readonly detail: SkillResult }) {
  const { t } = useLingui();
  const { libraryItemHref } = useConversationActions();
  const { result, tool } = detail;
  const { skill } = result;
  const edit = useMemo(
    () =>
      result.status === "saved" && result.previousSkillMd !== undefined
        ? versionEdit("SKILL.md", result.previousSkillMd, result.skillMd)
        : null,
    [result]
  );
  const files = skill.files.length;
  const { name } = skill;
  return (
    <section
      aria-label={t`Skill: ${name}`}
      className="not-prose flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2 text-card-foreground text-sm"
      data-slot="skill-card"
    >
      <div className="flex min-w-0 items-center gap-3">
        <SparklesIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-muted-foreground text-xs">
            <Action tool={tool} />
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-medium">{name}</span>
            <StateBadge skill={skill} />
          </p>
          <p className="text-muted-foreground text-xs">
            <Trans>
              In <LibraryName library={skill.library} />
            </Trans>
            {files > 0 ? (
              <>
                {" · "}
                <Plural one="# file" other="# files" value={files} />
              </>
            ) : null}
          </p>
        </div>
        {libraryItemHref ? (
          <a
            className={buttonVariants({ size: "xs", variant: "outline" })}
            href={libraryItemHref(skill.skillId)}
          >
            <ExternalLinkIcon aria-hidden data-icon="inline-start" />
            <Trans>Open in Library</Trans>
          </a>
        ) : null}
      </div>
      {result.status === "saved" && result.previousSkillMd !== undefined ? (
        <SkillChanges edit={edit} />
      ) : null}
    </section>
  );
}

function Destination({
  library,
}: {
  readonly library: { readonly name: string; readonly type: "org" | "team" };
}) {
  const { name } = library;
  return library.type === "team" ? (
    <Trans>the {name} team library</Trans>
  ) : (
    <Trans>the {name} org library</Trans>
  );
}

function FileList({ paths }: { readonly paths: readonly string[] }) {
  return paths.length > 0 ? (
    <ul className="flex flex-wrap gap-1">
      {paths.map((path) => (
        <li key={path}>
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
            {path}
          </code>
        </li>
      ))}
    </ul>
  ) : null;
}

function PublishSubject({ input }: { readonly input: JsonValue }) {
  const parsed = publishSkillInputSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const { library, notes, skillName } = parsed.data;
  return (
    <div className="flex flex-col gap-1 text-sm" data-slot="skill-approval">
      <p className="font-medium">
        {library ? (
          <Trans>
            The agent wants to publish the skill {skillName} to{" "}
            <Destination library={library} />.
          </Trans>
        ) : (
          <Trans>
            The agent wants to publish the skill {skillName} in your library.
          </Trans>
        )}
      </p>
      <p className="text-muted-foreground text-xs">
        {library ? (
          <Trans>
            Its next version is published, and a copy goes into that library,
            which owns it with you as a maintainer. Everyone in it can use it.
          </Trans>
        ) : (
          <Trans>
            Its draft becomes the next version, which anyone it's shared with
            gets.
          </Trans>
        )}
      </p>
      {notes ? (
        <p className="text-muted-foreground text-xs">
          <Trans>Notes: {notes}</Trans>
        </p>
      ) : null}
    </div>
  );
}

function UpdateSubject({ input }: { readonly input: JsonValue }) {
  const parsed = updateSkillInputSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const { description, files, instructions, name, removeFiles } = parsed.data;
  const added = (files ?? []).map((file) => file.path);
  const removed = removeFiles ?? [];
  return (
    <div className="flex flex-col gap-1 text-sm" data-slot="skill-approval">
      <p className="font-medium">
        {name ? (
          <Trans>
            The agent wants to change a skill's draft, and name it {name}.
          </Trans>
        ) : (
          <Trans>The agent wants to change a skill's draft.</Trans>
        )}
      </p>
      <ul className="list-disc ps-5 text-muted-foreground text-xs">
        {instructions === undefined ? null : (
          <li>
            <Trans>New instructions (SKILL.md)</Trans>
          </li>
        )}
        {description === undefined ? null : (
          <li>
            <Trans>New description: {description}</Trans>
          </li>
        )}
        {added.length > 0 ? (
          <li>
            <Trans>Adds or replaces files</Trans>
            <FileList paths={added} />
          </li>
        ) : null}
        {removed.length > 0 ? (
          <li>
            <Trans>Removes files</Trans>
            <FileList paths={removed} />
          </li>
        ) : null}
      </ul>
      <p className="text-muted-foreground text-xs">
        <Trans>What's published doesn't change until it's published.</Trans>
      </p>
    </div>
  );
}

function CreateSubject({ input }: { readonly input: JsonValue }) {
  const parsed = createSkillInputSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const { description, files, instructions, name } = parsed.data;
  return (
    <div className="flex flex-col gap-1 text-sm" data-slot="skill-approval">
      <p className="font-medium">
        <Trans>
          The agent wants to create the skill {name} as a draft in your library.
        </Trans>
      </p>
      <p className="text-muted-foreground text-xs">{description}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs">
        {instructions}
      </pre>
      <FileList paths={(files ?? []).map((file) => file.path)} />
    </div>
  );
}

/**
 * What a skill call waiting on approval will do, from its input. For a
 * publish, the skill's name and the library are what the server checks
 * before it publishes, so this is exactly where it lands.
 */
export function SkillApprovalSubject({
  input,
  tool,
}: {
  readonly input: JsonValue;
  readonly tool: SkillAuthoringTool;
}) {
  switch (tool) {
    case "create_skill":
      return <CreateSubject input={input} />;
    case "update_skill":
      return <UpdateSubject input={input} />;
    case "publish_skill":
      return <PublishSubject input={input} />;
    default:
      return tool satisfies never;
  }
}
