"use client";

import { ArtifactFullView } from "@workspace/chat-ui/artifacts/artifact-full-view";
import {
  type ArtifactLinkComponent,
  ArtifactsPage,
} from "@workspace/chat-ui/artifacts/artifacts-page";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useAppFrame } from "@/app/(app)/_shared/app-frame";
import { routes } from "@/lib/routes";

// The Artifacts page and an artifact's own page (124), over the app's API
// client and router. The screens live in chat-ui; this names the routes.

const NextLink: ArtifactLinkComponent = ({ children, className, href }) => (
  <Link className={className} href={href}>
    {children}
  </Link>
);

const useLinks = () => {
  const router = useRouter();
  return useMemo(
    () => ({
      artifact: routes.artifact,
      artifacts: routes.artifacts,
      chat: (id: Parameters<typeof routes.chat>[0]) => routes.chat(id),
      navigate: (href: string) => router.push(href),
    }),
    [router]
  );
};

export function ArtifactsScreen() {
  const { query } = useApi();
  const { me } = useAppFrame();
  const router = useRouter();
  const links = useLinks();
  const start = useCallback(
    (prompt: string) => router.push(routes.askAi(prompt)),
    [router]
  );
  return (
    <ArtifactsPage
      api={query}
      link={NextLink}
      links={links}
      me={me}
      onStart={start}
    />
  );
}

export function ArtifactScreen({
  id,
  runtimeOrigin,
}: {
  readonly id: ArtifactId;
  readonly runtimeOrigin: string | null;
}) {
  const { query } = useApi();
  const { me } = useAppFrame();
  const links = useLinks();
  return (
    <ArtifactFullView
      api={query}
      id={id}
      link={NextLink}
      links={links}
      me={me}
      runtimeOrigin={runtimeOrigin}
    />
  );
}
