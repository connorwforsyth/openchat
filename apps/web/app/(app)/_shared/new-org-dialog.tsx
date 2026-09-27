"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Org } from "@workspace/contract/schemas/tenancy";
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
import { Spinner } from "@workspace/ui/components/spinner";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useState,
} from "react";

import { useApi } from "./api";
import { slugFrom } from "./org-slug";
import { codeOf } from "./query-state";

// "New organisation" from the account menu (D17: anyone can create an org).
// One field to fill: the short name (the org's unique slug) follows the name
// until someone edits it. Creating makes the caller its owner; the caller
// decides where to go next (the new org's teams).

type Problem = "taken" | "failed" | null;

export interface NewOrgDialogProps {
  readonly onCreated: (org: Org) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

export function NewOrgDialog({
  onCreated,
  onOpenChange,
  open,
}: NewOrgDialogProps) {
  const { t } = useLingui();
  const ids = useId();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  // `null` while the short name follows the name.
  const [slugEdit, setSlugEdit] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const slug = slugEdit ?? slugFrom(name);

  const create = useMutation(
    query.orgs.create.mutationOptions({
      onSuccess: async () => {
        // The account menu, admin, and the chat context chip all read `me`.
        await queryClient.invalidateQueries({ queryKey: query.me.key() });
        await queryClient.invalidateQueries({ queryKey: query.orgs.key() });
      },
    })
  );
  const { isPending, mutate, reset } = create;

  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        setName("");
        setSlugEdit(null);
        setProblem(null);
        reset();
      }
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );
  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.currentTarget.value);
    setProblem(null);
  }, []);
  const changeSlug = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSlugEdit(event.currentTarget.value.toLowerCase());
    setProblem(null);
  }, []);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!(trimmed && slug)) {
        return;
      }
      mutate(
        { name: trimmed, slug },
        {
          onError: (error) =>
            setProblem(codeOf(error) === "CONFLICT" ? "taken" : "failed"),
          onSuccess: (org) => {
            changeOpen(false);
            onCreated(org);
          },
        }
      );
    },
    [changeOpen, mutate, name, onCreated, slug]
  );

  const nameId = `${ids}-name`;
  const slugId = `${ids}-slug`;
  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent>
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Trans>New organisation</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                You'll be its owner. Next, add teams and invite people.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>
                <Trans>Organisation name</Trans>
              </FieldLabel>
              <Input
                autoComplete="organization"
                autoFocus
                id={nameId}
                maxLength={200}
                onChange={changeName}
                placeholder={t`Acme`}
                required
                value={name}
              />
            </Field>
            <Field data-invalid={problem === "taken" || undefined}>
              <FieldLabel htmlFor={slugId}>
                <Trans>Short name</Trans>
              </FieldLabel>
              <Input
                aria-invalid={problem === "taken" || undefined}
                autoCapitalize="none"
                autoComplete="off"
                id={slugId}
                maxLength={48}
                onChange={changeSlug}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
                spellCheck={false}
                value={slug}
              />
              <FieldDescription>
                <Trans>
                  Unique on this server: lowercase letters, digits and dashes.
                </Trans>
              </FieldDescription>
            </Field>
            {problem ? (
              <FieldError>
                {problem === "taken" ? (
                  <Trans>That short name is taken. Try another.</Trans>
                ) : (
                  <Trans>
                    The organisation couldn't be created. Try again.
                  </Trans>
                )}
              </FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={isPending || !(name.trim() && slug)}
              type="submit"
            >
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              <Trans>Create organisation</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
