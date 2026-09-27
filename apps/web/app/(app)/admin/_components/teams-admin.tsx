"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type { Team } from "@workspace/contract/schemas/tenancy";
import { NetworkIcon, PencilIcon, Trash2Icon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";

import { useApi } from "../../_shared/api";
import { ConfirmButton } from "../../_shared/confirm";
import { type Option, OptionSelect } from "../../_shared/option-select";
import { codeOf, QueryState } from "../../_shared/query-state";
import { buildTeamTree, flattenTree, type TeamNode } from "./team-tree";

// The team tree (D17): teams nest inside teams; access granted to a team
// flows to its sub-teams and usage rolls up. Create, rename and delete here;
// a team with sub-teams can't be deleted until they're moved or removed.

const TOP_LEVEL = "top";

const TeamRow = ({
  node,
  onDelete,
  onRename,
}: {
  readonly node: TeamNode;
  readonly onDelete: (team: Team) => void;
  readonly onRename: (team: Team, name: string) => void;
}) => {
  const { t } = useLingui();
  const { team } = node;
  const { name } = team;
  const [editing, setEditing] = useState(false);
  const startEditing = useCallback(() => setEditing(true), []);
  const remove = useCallback(() => onDelete(team), [onDelete, team]);
  const commit = useCallback(
    (value: string) => {
      setEditing(false);
      const trimmed = value.trim();
      if (trimmed && trimmed !== name) {
        onRename(team, trimmed);
      }
    },
    [name, onRename, team]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        commit(event.currentTarget.value);
      } else if (event.key === "Escape") {
        setEditing(false);
      }
    },
    [commit]
  );
  const onBlur = useCallback(
    (event: { readonly currentTarget: HTMLInputElement }) =>
      commit(event.currentTarget.value),
    [commit]
  );
  return (
    <li
      className="flex min-h-10 items-center gap-2 py-1"
      // Indentation shows the tree; logical padding so it mirrors in RTL.
      style={{ paddingInlineStart: `${node.depth * 1.25}rem` }}
    >
      {editing ? (
        <Input
          aria-label={t`New name for ${name}`}
          autoFocus
          className="h-8 max-w-64"
          defaultValue={name}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{name}</span>
      )}
      <span className="ms-auto flex items-center gap-1">
        <Button
          aria-label={t`Rename ${name}`}
          onClick={startEditing}
          size="icon-sm"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <ConfirmButton
          confirmLabel={<Trans>Delete team</Trans>}
          description={
            <Trans>
              Members keep their accounts. Grants and budgets given to this team
              go away with it.
            </Trans>
          }
          label={t`Delete ${name}`}
          onConfirm={remove}
          title={<Trans>Delete {name}?</Trans>}
        >
          <Trash2Icon />
        </ConfirmButton>
      </span>
    </li>
  );
};

const CreateTeamForm = ({
  onCreated,
  orgId,
  teams,
}: {
  readonly onCreated: () => void;
  readonly orgId: OrgId;
  readonly teams: readonly Team[];
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const [parent, setParent] = useState<string>(TOP_LEVEL);
  const [failed, setFailed] = useState(false);
  const create = useMutation(query.teams.create.mutationOptions());
  const { mutate } = create;
  const parents: readonly Option<string>[] = [
    { label: t`Top level`, value: TOP_LEVEL },
    ...flattenTree(buildTeamTree(teams)).map((node) => ({
      label: `${"— ".repeat(node.depth)}${node.team.name}`,
      value: node.team.id,
    })),
  ];
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = String(new FormData(form).get("name") ?? "").trim();
      if (!name) {
        return;
      }
      const parentTeam = teams.find((team) => team.id === parent);
      mutate(
        { name, orgId, parentId: parentTeam?.id ?? null },
        {
          onError: () => setFailed(true),
          onSuccess: () => {
            setFailed(false);
            form.reset();
            onCreated();
          },
        }
      );
    },
    [mutate, onCreated, orgId, parent, teams]
  );
  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="team-name">
              <Trans>Team name</Trans>
            </FieldLabel>
            <Input id="team-name" maxLength={200} name="name" required />
          </Field>
          <Field className="sm:w-56">
            <FieldLabel htmlFor="team-parent">
              <Trans>Inside</Trans>
            </FieldLabel>
            <OptionSelect
              id="team-parent"
              onChange={setParent}
              options={parents}
              value={parent}
            />
          </Field>
          <Button disabled={create.isPending} type="submit">
            <Trans>Create team</Trans>
          </Button>
        </div>
        {failed ? (
          <FieldError>
            <Trans>The team couldn't be created. Try again.</Trans>
          </FieldError>
        ) : null}
      </FieldGroup>
    </form>
  );
};

export const TeamsAdmin = ({ orgId }: { readonly orgId: OrgId }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<"not_empty" | "failed" | null>(null);
  const teams = useQuery(query.teams.list.queryOptions({ input: { orgId } }));
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.teams.key() }),
    [query, queryClient]
  );
  const onError = useCallback((error: Error) => {
    setProblem(codeOf(error) === "CONFLICT" ? "not_empty" : "failed");
  }, []);
  const rename = useMutation(
    query.teams.update.mutationOptions({ onError, onSettled: refresh })
  );
  const remove = useMutation(
    query.teams.delete.mutationOptions({ onError, onSettled: refresh })
  );
  const { mutate: mutateRename } = rename;
  const { mutate: mutateRemove } = remove;
  const onRename = useCallback(
    (team: Team, name: string) => {
      setProblem(null);
      mutateRename({ id: team.id, name });
    },
    [mutateRename]
  );
  const onDelete = useCallback(
    (team: Team) => {
      setProblem(null);
      mutateRemove({ id: team.id });
    },
    [mutateRemove]
  );

  return (
    <div className="flex flex-col gap-8">
      <QueryState query={teams}>
        {(list) =>
          list.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <NetworkIcon />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans>No teams yet</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>
                    Teams group members for sharing, keys and budgets. Sub-teams
                    inherit what their parent is given.
                  </Trans>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {flattenTree(buildTeamTree(list)).map((node) => (
                <TeamRow
                  key={node.team.id}
                  node={node}
                  onDelete={onDelete}
                  onRename={onRename}
                />
              ))}
            </ul>
          )
        }
      </QueryState>
      {problem ? (
        <p className="text-destructive text-sm" role="alert">
          {problem === "not_empty" ? (
            <Trans>That team has sub-teams. Delete or move them first.</Trans>
          ) : (
            <Trans>That change couldn't be saved. Try again.</Trans>
          )}
        </p>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>New team</Trans>
        </h2>
        <CreateTeamForm
          onCreated={refresh}
          orgId={orgId}
          teams={teams.data ?? []}
        />
      </section>
    </div>
  );
};
