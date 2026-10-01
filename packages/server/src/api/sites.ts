import { randomBytes } from "node:crypto";
import { DEFAULT_SITE_STACK } from "@workspace/artifacts-kit/kinds/site/content";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import type { ArtifactPublication } from "@workspace/contract/schemas/files";
import type { FileEntry } from "@workspace/contract/schemas/sandbox";
import type { ArtifactPublicationRow } from "@workspace/db/queries/artifacts";

import type { SandboxApi } from "./sandbox";

// Sites (125), as the artifacts routes need them: what publishing needs to
// know about the instance, the public link's URL and token, and how a
// workspace folder becomes a Site's content. The checks themselves are the
// kind's (`@workspace/artifacts-kit`).

export interface SitesDeps {
  /** The instance's kinds (`instanceArtifactKinds`): saves and publishes are checked against them. */
  readonly kinds: ArtifactKindRegistry;
  /** `features.publicLinks`: a published site is a public link. */
  readonly publicLinks: boolean;
  /**
   * The artifact runtime's origin (`ARTIFACTS_ORIGIN`), which serves
   * published sites; `null` when there's none, and nothing can be published.
   */
  readonly runtimeOrigin: string | null;
  /** Reads a chat's workspace, for "Save as artifact". */
  readonly workspace: Pick<SandboxApi, "get" | "listFiles" | "readFile">;
}

/** An unguessable token for a public link. */
export const mintPublicationToken = (): string =>
  randomBytes(32).toString("base64url");

/** Where the runtime serves a published artifact. */
export const publicationUrl = (runtimeOrigin: string, token: string): string =>
  `${runtimeOrigin}/s/${token}/`;

export const toPublication = (
  row: ArtifactPublicationRow,
  runtimeOrigin: string
): ArtifactPublication => ({
  artifactId: row.artifactId,
  publishedAt: row.publishedAt.toISOString(),
  publishedBy: row.publishedBy,
  token: row.token,
  url: publicationUrl(runtimeOrigin, row.token),
  versionId: row.versionId,
});

/** `http(s)` origin of `value`, or `null`; a path or anything else is dropped. */
export const runtimeOriginOf = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!(trimmed && URL.canParse(trimmed))) {
    return null;
  }
  const url = new URL(trimmed);
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.origin
    : null;
};

const depth = (path: string) => path.split("/").length;
const HIDDEN = /(?:^|\/)\./;

/**
 * The files a recursive listing of one folder holds, by their path inside
 * it. A listing gives paths as the workspace has them (`/work/site/a.html`);
 * the folder is the parent of its shallowest entry. Hidden files and
 * folders (`.git`, `.DS_Store`) are left out, as a static host leaves them.
 */
export const folderFiles = (
  entries: readonly FileEntry[]
): readonly { readonly path: string; readonly relative: string }[] => {
  const [shallowest] = [...entries].sort(
    (a, b) => depth(a.path) - depth(b.path)
  );
  if (!shallowest) {
    return [];
  }
  const folder = shallowest.path.slice(0, shallowest.path.lastIndexOf("/") + 1);
  return entries
    .filter((entry) => entry.type === "file" && entry.path.startsWith(folder))
    .map((entry) => ({
      path: entry.path,
      relative: entry.path.slice(folder.length),
    }))
    .filter(({ relative }) => !HIDDEN.test(relative))
    .sort((a, b) => a.relative.localeCompare(b.relative));
};

/** A site's stored content from its files. */
export const siteContentFrom = (
  files: readonly { readonly relative: string; readonly text: string }[]
): string =>
  JSON.stringify({
    files: Object.fromEntries(
      files.map(({ relative, text }) => [relative, text])
    ),
    stack: DEFAULT_SITE_STACK,
  });
