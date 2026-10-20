"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  AttachIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  LibraryIcon,
  PlusIcon,
  SparklesIcon,
  ZapIcon,
} from "@workspace/icons";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { type Ref, useCallback } from "react";
import type { ComposerConnectors } from "../props";
import type { FileCandidate, PromptOption, SkillOption } from "../schemas";
import type { FastMode } from "../variants";
import { ConnectorsMenu } from "./connectors-menu";

export interface PlusMenuProps {
  readonly attachDisabled: boolean;
  /** This chat's connectors (188); left out, the submenu isn't offered. */
  readonly connectors?: ComposerConnectors | undefined;
  readonly disabled: boolean;
  /**
   * Fast mode for the chosen model (105); left out when it has none, and
   * the switch isn't offered. Separate from its thinking level.
   */
  readonly fast?: FastMode & { readonly on: boolean };
  /** Workspace files to add to the message, as `/open` lists them. */
  readonly files: readonly FileCandidate[];
  readonly onAddFile: ((file: FileCandidate) => void) | undefined;
  /** Puts a skill on the message (127); left out, skills aren't offered. */
  readonly onAddSkill?: ((skill: SkillOption) => void) | undefined;
  readonly onAttach: () => void;
  readonly onFastChange?: (on: boolean) => void;
  /**
   * Starts a message asking for a picture (138); left out when the chosen
   * model can't make one, and the item isn't offered.
   */
  readonly onMakeImage?: (() => void) | undefined;
  /** Plan mode (106); left out, the switch isn't offered. */
  readonly onPlanChange?: ((on: boolean) => void) | undefined;
  readonly onUsePrompt: ((prompt: PromptOption) => void) | undefined;
  /** Left out when the instance has no web search: the item isn't offered. */
  readonly onWebSearchChange: ((on: boolean) => void) | undefined;
  /** Whether the next message plans rather than builds. */
  readonly plan?: boolean;
  readonly prompts: readonly PromptOption[];
  /** Skills to pick, less those already on the message. */
  readonly skills?: readonly SkillOption[];
  readonly triggerRef?: Ref<HTMLButtonElement>;
  readonly webSearch: boolean;
}

function FileItem({
  file,
  onChoose,
}: {
  readonly file: FileCandidate;
  readonly onChoose: (file: FileCandidate) => void;
}) {
  const choose = useCallback(() => onChoose(file), [file, onChoose]);
  return (
    <DropdownMenuItem label={file.label} onClick={choose}>
      <span className="truncate">{file.label}</span>
      {file.description ? (
        <span className="ms-auto truncate ps-2 text-muted-foreground text-xs">
          {file.description}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

function PromptItem({
  onChoose,
  prompt,
}: {
  readonly onChoose: (prompt: PromptOption) => void;
  readonly prompt: PromptOption;
}) {
  const choose = useCallback(() => onChoose(prompt), [onChoose, prompt]);
  return (
    <DropdownMenuItem label={prompt.name} onClick={choose}>
      <span className="truncate">{prompt.name}</span>
      <span className="ms-auto ps-2 text-muted-foreground text-xs">
        /{prompt.definition.command}
      </span>
    </DropdownMenuItem>
  );
}

function SkillItem({
  onChoose,
  skill,
}: {
  readonly onChoose: (skill: SkillOption) => void;
  readonly skill: SkillOption;
}) {
  const choose = useCallback(() => onChoose(skill), [onChoose, skill]);
  return (
    <DropdownMenuItem label={skill.name} onClick={choose}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{skill.name}</span>
        {skill.description ? (
          <span className="truncate text-muted-foreground text-xs">
            {skill.description}
          </span>
        ) : null}
      </span>
    </DropdownMenuItem>
  );
}

const NO_SKILLS: readonly SkillOption[] = [];

// Long lists scroll inside their submenu rather than past the screen.
const SUBMENU_CLASS = "max-h-72 w-64 max-w-[calc(100vw-2rem)]";

/**
 * The composer's + menu: things to add to the next message. Attach files is
 * always first; a workspace file, a prompt and a skill (127) appear when
 * there are some to pick; plan mode is a switch (a read-only planning run, 106), web search
 * one for the instance that has it, and fast mode one for a model that has
 * a fast variant. Base UI's menu
 * gives it arrow keys, type-ahead, and Escape back to the + button.
 */
export function PlusMenu({
  attachDisabled,
  connectors,
  disabled,
  fast,
  files,
  onAddFile,
  onAddSkill,
  onAttach,
  onFastChange,
  onMakeImage,
  onPlanChange,
  onUsePrompt,
  onWebSearchChange,
  plan = false,
  prompts,
  skills = NO_SKILLS,
  triggerRef,
  webSearch,
}: PlusMenuProps) {
  const { t } = useLingui();
  // Base UI passes event details too; the host gets just the switch.
  const switchWebSearch = useCallback(
    (on: boolean) => onWebSearchChange?.(on),
    [onWebSearchChange]
  );
  const switchPlan = useCallback(
    (on: boolean) => onPlanChange?.(on),
    [onPlanChange]
  );
  const switchFast = useCallback(
    (on: boolean) => onFastChange?.(on),
    [onFastChange]
  );
  const offerFast = fast !== undefined && onFastChange !== undefined;
  const offerFiles = onAddFile !== undefined && files.length > 0;
  const offerPrompts = onUsePrompt !== undefined && prompts.length > 0;
  const offerSkills = onAddSkill !== undefined && skills.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            aria-label={t`Add to message`}
            className="rounded-full"
            disabled={disabled}
            ref={triggerRef}
            size="icon-sm"
            variant="outline"
          />
        }
      >
        <PlusIcon aria-hidden />
      </DropdownMenuTrigger>
      {/* Base UI's menu matches the trigger's width by default; an icon-sized
          trigger would squeeze the items, so size to them instead. */}
      <DropdownMenuContent align="start" className="w-auto min-w-52">
        <DropdownMenuItem disabled={attachDisabled} onClick={onAttach}>
          <AttachIcon aria-hidden />
          <Trans>Attach files</Trans>
        </DropdownMenuItem>
        {onMakeImage ? (
          <DropdownMenuItem onClick={onMakeImage}>
            <ImageIcon aria-hidden />
            <span className="flex min-w-0 flex-col">
              <Trans>Image</Trans>
              <span className="text-muted-foreground text-xs">
                <Trans>Describe a picture to make</Trans>
              </span>
            </span>
          </DropdownMenuItem>
        ) : null}
        {offerFiles ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FileIcon aria-hidden />
              <Trans>Add a workspace file</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={SUBMENU_CLASS}>
              {files.map((file) => (
                <FileItem file={file} key={file.path} onChoose={onAddFile} />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {offerPrompts ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LibraryIcon aria-hidden />
              <Trans>Use a prompt</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={SUBMENU_CLASS}>
              {prompts.map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  onChoose={onUsePrompt}
                  prompt={prompt}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {offerSkills ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SparklesIcon aria-hidden />
              <Trans>Skills</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={SUBMENU_CLASS}>
              {skills.map((skill) => (
                <SkillItem key={skill.id} onChoose={onAddSkill} skill={skill} />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {connectors ? <ConnectorsMenu connectors={connectors} /> : null}
        {onPlanChange || onWebSearchChange || offerFast ? (
          <DropdownMenuSeparator />
        ) : null}
        {onPlanChange ? (
          <DropdownMenuCheckboxItem checked={plan} onCheckedChange={switchPlan}>
            <FileTextIcon aria-hidden />
            <span className="flex min-w-0 flex-col">
              <Trans>Plan</Trans>
              <span className="text-muted-foreground text-xs">
                <Trans>Look first, change nothing</Trans>
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        ) : null}
        {onWebSearchChange ? (
          <DropdownMenuCheckboxItem
            checked={webSearch}
            onCheckedChange={switchWebSearch}
          >
            <GlobeIcon aria-hidden />
            <Trans>Web search</Trans>
          </DropdownMenuCheckboxItem>
        ) : null}
        {offerFast ? (
          <DropdownMenuCheckboxItem
            checked={fast.on}
            disabled={fast.blocked !== undefined}
            onCheckedChange={switchFast}
          >
            <ZapIcon aria-hidden />
            <span className="flex min-w-0 flex-col">
              <Trans>Fast mode</Trans>
              {fast.blocked === "server" ? (
                <span className="text-muted-foreground text-xs">
                  <Trans>Needs server support</Trans>
                </span>
              ) : null}
              {fast.blocked === "unavailable" ? (
                <span className="text-muted-foreground text-xs">
                  <Trans>No key in this context</Trans>
                </span>
              ) : null}
            </span>
          </DropdownMenuCheckboxItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
