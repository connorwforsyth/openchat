"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ArtifactListItem } from "@workspace/contract/schemas/files";
import { CopyIcon, ExternalLinkIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { useCallback, useState } from "react";

// Publishing a site (125): a public link on the artifact runtime's origin
// that serves the version published. The owner publishes, publishes the
// latest version again (the link stays the same), or takes it down.

/** Why publishing failed, as the dialog says it. Pure. */
export const publishProblem = (
  error: unknown
):
  | { readonly kind: "disabled" }
  | { readonly kind: "invalid"; readonly issues: readonly string[] }
  | { readonly kind: "failed" } => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return { kind: "failed" };
  }
  if (error.code === "FEATURE_DISABLED") {
    return { kind: "disabled" };
  }
  if (error.code === "VALIDATION") {
    const { data } = error as { readonly data?: { readonly issues?: unknown } };
    const issues = Array.isArray(data?.issues)
      ? data.issues.flatMap((issue: unknown) =>
          typeof issue === "object" &&
          issue !== null &&
          "message" in issue &&
          typeof issue.message === "string"
            ? [issue.message]
            : []
        )
      : [];
    return { issues, kind: "invalid" };
  }
  return { kind: "failed" };
};

export function PublishDialog({
  api,
  artifact,
  onOpenChange,
  open,
}: {
  readonly api: QueryUtils;
  readonly artifact: ArtifactListItem;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const publication = useQuery({
    ...api.artifacts.publication.queryOptions({ input: { id: artifact.id } }),
    enabled: open,
  });
  const { refetch } = publication;
  const publish = useMutation(
    api.artifacts.publish.mutationOptions({ onSettled: () => refetch() })
  );
  const unpublish = useMutation(
    api.artifacts.unpublish.mutationOptions({ onSettled: () => refetch() })
  );
  const { mutate: publishIt, reset: resetPublish } = publish;
  const { mutate: unpublishIt } = unpublish;
  const link = publication.data ?? null;
  const upToDate = link !== null && link.versionId === artifact.latestVersionId;
  const problem = publish.error ? publishProblem(publish.error) : null;

  const doPublish = useCallback(
    () => publishIt({ id: artifact.id }),
    [artifact.id, publishIt]
  );
  const doUnpublish = useCallback(() => {
    resetPublish();
    unpublishIt({ id: artifact.id });
  }, [artifact.id, resetPublish, unpublishIt]);
  const copy = useCallback(() => {
    if (link) {
      navigator.clipboard?.writeText(link.url).then(
        () => setCopied(true),
        () => setCopied(false)
      );
    }
  }, [link]);
  const openChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setCopied(false);
        resetPublish();
      }
      onOpenChange(next);
    },
    [onOpenChange, resetPublish]
  );
  const busy = publish.isPending || unpublish.isPending;

  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Publish {artifact.title}</Trans>
          </DialogTitle>
          <DialogDescription>
            {link ? (
              <Trans>
                Anyone with the link can see this site. It shows the version you
                published until you publish again.
              </Trans>
            ) : (
              <Trans>
                Publishing makes a public link to this site. Anyone with the
                link can see it, without signing in.
              </Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label={t`Public link`}
              className="font-mono text-xs"
              readOnly
              value={link.url}
            />
            <Button
              aria-label={copied ? t`Copied` : t`Copy link`}
              onClick={copy}
              size="icon"
              variant="outline"
            >
              <CopyIcon aria-hidden />
            </Button>
            <Button
              aria-label={t`Open the published site`}
              nativeButton={false}
              render={
                <a href={link.url} rel="noopener noreferrer" target="_blank" />
              }
              size="icon"
              variant="outline"
            >
              <ExternalLinkIcon aria-hidden />
            </Button>
          </div>
        ) : null}

        {problem ? (
          <div className="text-destructive text-sm" role="alert">
            {problem.kind === "disabled" ? (
              <Trans>Publishing isn't available on this instance.</Trans>
            ) : null}
            {problem.kind === "failed" ? (
              <Trans>The site couldn't be published. Try again.</Trans>
            ) : null}
            {problem.kind === "invalid" ? (
              <>
                <p>
                  <Trans>This version can't be published yet:</Trans>
                </p>
                <ul className="mt-1 list-disc ps-5">
                  {problem.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {link ? (
            <Button disabled={busy} onClick={doUnpublish} variant="outline">
              <Trans>Unpublish</Trans>
            </Button>
          ) : null}
          {upToDate ? null : (
            <Button
              disabled={busy || publication.isPending}
              onClick={doPublish}
            >
              {link ? (
                <Trans>Publish latest version</Trans>
              ) : (
                <Trans>Publish</Trans>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
