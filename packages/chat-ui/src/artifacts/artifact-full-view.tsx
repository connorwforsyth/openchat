"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type {
  ArtifactId,
  ArtifactVersionId,
} from "@workspace/contract/schemas/common";
import type { Me } from "@workspace/contract/schemas/meta";
import { ArrowLeftIcon, MessageSquareIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { ArtifactMenu } from "./artifact-actions";
import { ArtifactView } from "./artifact-view";
import type {
  ArtifactLinkComponent,
  ArtifactPageLinks,
} from "./artifacts-page";
import { KindIcon } from "./kind-icon";

// An artifact on a page of its own (124, `/artifacts/<id>`): the kind's
// viewer with every version, and the same actions as its row. "Open chat"
// goes back to the chat that made it, for people who can open that chat.
// Opening it records "Viewed" for the Artifacts page.

export interface ArtifactFullViewProps {
  readonly api: QueryUtils;
  readonly id: ArtifactId;
  readonly link: ArtifactLinkComponent;
  readonly links: ArtifactPageLinks & { readonly artifacts: string };
  readonly me: Me;
  /** The artifact runtime's origin (`runtimeOriginFrom`); `null` for `srcdoc` previews. */
  readonly runtimeOrigin?: string | null;
}

export function ArtifactFullView({
  api,
  id,
  link: Link,
  links,
  me,
  runtimeOrigin = null,
}: ArtifactFullViewProps) {
  const { t } = useLingui();
  const detail = useQuery(api.artifacts.detail.queryOptions({ input: { id } }));
  const [versionId, setVersionId] = useState<ArtifactVersionId | undefined>();
  const viewed = useMutation(api.artifacts.markViewed.mutationOptions());
  const { mutate: markViewed } = viewed;
  useEffect(() => {
    markViewed({ id });
  }, [id, markViewed]);

  const select = useCallback(
    (selection: { readonly versionId?: ArtifactVersionId }) =>
      setVersionId(selection.versionId),
    []
  );
  const { navigate } = links;
  const leave = useCallback(
    () => navigate(links.artifacts),
    [links.artifacts, navigate]
  );

  const artifact = detail.data?.artifact;
  const kind = artifact?.kind;
  const conversationId = artifact?.conversationId;
  const goToChat = useCallback(() => {
    if (conversationId) {
      navigate(links.chat(conversationId));
    }
  }, [conversationId, links, navigate]);
  const header = useCallback(
    (content: ReactNode) => (
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {kind ? (
          <KindIcon
            className="size-4 shrink-0 text-muted-foreground"
            kind={kind}
          />
        ) : null}
        {content}
      </div>
    ),
    [kind]
  );
  const back = (
    <Link
      className="inline-flex items-center gap-1 text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:underline"
      href={links.artifacts}
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      <Trans>Artifacts</Trans>
    </Link>
  );

  if (detail.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-muted-foreground text-sm" role="alert">
          <Trans>
            This artifact doesn't exist, or it isn't shared with you.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        {artifact ? (
          <div className="flex items-center gap-2">
            {artifact.canGoToChat ? (
              <Button onClick={goToChat} size="sm" variant="outline">
                <MessageSquareIcon aria-hidden data-icon="inline-start" />
                <Trans>Open chat</Trans>
              </Button>
            ) : null}
            <ArtifactMenu
              api={api}
              artifact={artifact}
              links={links}
              me={me}
              onDeleted={leave}
              variant="outline"
            />
          </div>
        ) : null}
      </div>
      <section
        aria-label={artifact?.title ?? t`Artifact`}
        className="flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-xl border border-border"
      >
        {artifact ? (
          <ArtifactView
            artifact={artifact}
            header={header}
            onSelect={select}
            runtimeOrigin={runtimeOrigin}
            versionId={versionId}
            versions={detail.data?.versions}
          />
        ) : (
          <p className="p-4 text-muted-foreground text-sm" role="status">
            <Trans>Loading…</Trans>
          </p>
        )}
      </section>
    </div>
  );
}
