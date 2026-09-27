"use client";

import { Trans } from "@lingui/react/macro";
import { createApiClient } from "@workspace/client/api";
import type { InvitationId } from "@workspace/contract/schemas/common";
import { Button } from "@workspace/ui/components/button";
import { FieldError } from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { useCallback, useState } from "react";

import { routes } from "@/lib/routes";

type Problem = "not_for_you" | "gone" | "failed";

const problemOf = (error: unknown): Problem => {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : null;
  if (status === 403) {
    return "not_for_you";
  }
  return status === 404 || status === 409 ? "gone" : "failed";
};

/** The invite link's token, or (deprecated) an invitation id from an older link. */
export type AcceptInviteInput =
  | { readonly token: string }
  | { readonly id: InvitationId };

/** Accepts an invitation for the signed-in user, then opens the app. */
export function AcceptInvite({ input }: { readonly input: AcceptInviteInput }) {
  const [client] = useState(() => createApiClient());
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const accept = useCallback(async () => {
    setPending(true);
    setProblem(null);
    try {
      await client.orgs.acceptInvitation(input);
      // A full load: the new org and its teams come with the next `me`.
      window.location.assign(routes.home);
    } catch (error) {
      setProblem(problemOf(error));
      setPending(false);
    }
  }, [client, input]);
  const onClick = useCallback(() => {
    accept().catch(() => setPending(false));
  }, [accept]);
  return (
    <div className="flex flex-col gap-3">
      <Button disabled={pending} onClick={onClick}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        <Trans>Accept invitation</Trans>
      </Button>
      {problem ? (
        <FieldError>
          {problem === "not_for_you" ? (
            <Trans>
              This invitation was sent to a different email address. Sign in
              with that address to accept it.
            </Trans>
          ) : null}
          {problem === "gone" ? (
            <Trans>
              This invitation has expired, was cancelled or was already used.
            </Trans>
          ) : null}
          {problem === "failed" ? (
            <Trans>The invitation couldn't be accepted. Try again.</Trans>
          ) : null}
        </FieldError>
      ) : null}
    </div>
  );
}
