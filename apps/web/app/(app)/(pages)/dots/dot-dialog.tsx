"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import type { Dot } from "@workspace/contract/schemas/dots";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";
import { AGENT_TABS, usableAgents } from "@/app/(app)/(chat)/usable-agents";
import { AvatarPicker } from "./avatar-picker";
import { DotAvatar } from "./dot-avatar";

// Editing who a Dot is (172): its name, @handle and look, what it helps
// with, what thinks for it (a model or a published agent) and its
// workspace. Schedules and rules live in their own profile tabs.

export const targetKey = (target: RunTarget): string =>
  target.type === "agent" ? `agent:${target.id}` : `model:${target.model}`;

export const targetOf = (key: string): RunTarget | null => {
  const index = key.indexOf(":");
  const kind = key.slice(0, index);
  const value = key.slice(index + 1);
  if (value === "") {
    return null;
  }
  return kind === "agent"
    ? ({ id: value, type: "agent" } as RunTarget)
    : ({ model: value, type: "model" } as RunTarget);
};

const AGENT_LIST_LIMIT = 100;

export const useTargetOptions = (): readonly Option<string>[] => {
  const { t } = useLingui();
  const { query } = useApi();
  const models = useQuery(
    query.meta.models.queryOptions({ input: { contextType: "personal" } })
  );
  const agents = useQueries({
    combine: (lists) =>
      usableAgents(
        AGENT_TABS.map((source, index) => ({
          items: lists[index]?.data?.items ?? [],
          source,
        }))
      ).agents,
    queries: AGENT_TABS.map((tab) =>
      query.library.list.queryOptions({
        input: { kind: "agent", limit: AGENT_LIST_LIMIT, tab },
      })
    ),
  });
  return useMemo(
    () => [
      ...(models.data ?? []).map((model) => ({
        disabled: !model.available,
        label: t`Model: ${model.label}`,
        value: `model:${model.selector}`,
      })),
      ...agents.map((agent) => {
        const { name } = agent;
        return { label: t`Agent: ${name}`, value: `agent:${agent.id}` };
      }),
    ],
    [agents, models.data, t]
  );
};

const LEADING_AT = /^@/;

interface SettingsDraft {
  readonly avatar: Dot["avatar"];
  readonly handle: string;
  readonly instructions: string;
  readonly name: string;
  readonly sandbox: "default" | SandboxProvider;
  /** `model:<selector>` or `agent:<id>`. */
  readonly target: string;
}

const draftOf = (dot: Dot): SettingsDraft => ({
  avatar: dot.avatar,
  handle: dot.handle,
  instructions: dot.instructions,
  name: dot.name,
  sandbox: dot.sandboxProvider ?? "default",
  target: targetKey(dot.target),
});

export interface DotSettingsDialogProps {
  readonly dot: Dot;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (dot: Dot) => void;
  readonly open: boolean;
}

export function DotSettingsDialog(props: DotSettingsDialogProps) {
  // Remounted per open, so the form starts from the Dot as it is now.
  return props.open ? <SettingsForm {...props} /> : null;
}

function SettingsForm({
  dot,
  onOpenChange,
  onSaved,
  open,
}: DotSettingsDialogProps) {
  const { t } = useLingui();
  const ids = useId();
  const { client } = useApi();
  const targets = useTargetOptions();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(dot));

  const save = useMutation({
    mutationFn: (): Promise<Dot> => {
      const runTarget = targetOf(draft.target);
      return client.dots.update({
        avatar: draft.avatar,
        handle: draft.handle.trim().replace(LEADING_AT, ""),
        id: dot.id,
        instructions: draft.instructions,
        name: draft.name.trim(),
        sandboxProvider: draft.sandbox === "default" ? null : draft.sandbox,
        ...(runTarget ? { target: runTarget } : {}),
      });
    },
    onSuccess: (saved) => {
      onSaved(saved);
      onOpenChange(false);
    },
  });

  const set = useCallback(
    <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    []
  );
  const setAvatar = useCallback(
    (avatar: Dot["avatar"]) => set("avatar", avatar),
    [set]
  );
  const setTarget = useCallback((value: string) => set("target", value), [set]);
  const setSandbox = useCallback(
    (value: SettingsDraft["sandbox"]) => set("sandbox", value),
    [set]
  );
  const text =
    (key: "handle" | "instructions" | "name") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, event.currentTarget.value);
  const { mutate } = save;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      mutate();
    },
    [mutate]
  );
  const sandboxes: readonly Option<SettingsDraft["sandbox"]>[] = useMemo(
    () => [
      { label: t`Server default`, value: "default" },
      { label: t`Simulated (just-bash)`, value: "just-bash" },
      { label: t`Docker (sandbox runner)`, value: "docker" },
    ],
    [t]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Trans>Edit {dot.name}</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Who it is, what it helps with, and what thinks for it.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="flex items-center gap-4">
              <DotAvatar avatar={draft.avatar} size="lg" />
              <AvatarPicker compact onChange={setAvatar} value={draft.avatar} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${ids}-name`}>
                  <Trans>Name</Trans>
                </FieldLabel>
                <Input
                  id={`${ids}-name`}
                  maxLength={24}
                  onChange={text("name")}
                  required
                  value={draft.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${ids}-handle`}>
                  <Trans>Handle</Trans>
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>@</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    autoComplete="off"
                    id={`${ids}-handle`}
                    maxLength={24}
                    onChange={text("handle")}
                    pattern="[a-z0-9][a-z0-9_\-]{1,23}"
                    required
                    value={draft.handle}
                  />
                </InputGroup>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${ids}-instructions`}>
                <Trans>What it helps with</Trans>
              </FieldLabel>
              <Textarea
                id={`${ids}-instructions`}
                maxLength={20_000}
                onChange={text("instructions")}
                rows={3}
                value={draft.instructions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-target`}>
                <Trans>Thinks with</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-target`}
                onChange={setTarget}
                options={targets}
                value={draft.target}
              />
              <FieldDescription>
                <Trans>
                  An agent brings its own tools and MCP servers; a model gets
                  the workspace and the server's built-in tools.
                </Trans>
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-sandbox`}>
                <Trans>Workspace</Trans>
              </FieldLabel>
              <OptionSelect
                id={`${ids}-sandbox`}
                onChange={setSandbox}
                options={sandboxes}
                value={draft.sandbox}
              />
            </Field>
            {save.isError ? (
              <FieldError>
                <Trans>
                  It couldn't be saved. The handle may be taken by another of
                  your Dots.
                </Trans>
              </FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button disabled={save.isPending} type="submit">
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              <Trans>Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
