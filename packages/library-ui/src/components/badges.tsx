"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LibraryAccess,
  LibraryItem,
} from "@workspace/contract/schemas/library";
import type { Me } from "@workspace/contract/schemas/meta";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { GlobeIcon, LockIcon, UsersIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";

// The small labels on cards and in the builder header: where an item stands
// (draft or published, and which version), who can see it, and what the
// caller may do with it.

/** Draft until the first publish (D13), then the latest version number. */
export function VersionBadge({
  item,
}: {
  readonly item: Pick<LibraryItem, "kind" | "latestVersionNumber">;
}) {
  if (item.kind === "mcp_server" || item.kind === "preset") {
    return null;
  }
  if (item.latestVersionNumber === null) {
    return (
      <Badge variant="outline">
        <Trans>Draft</Trans>
      </Badge>
    );
  }
  const version = item.latestVersionNumber;
  return (
    <Badge variant="secondary">
      <Trans>Published v{version}</Trans>
    </Badge>
  );
}

export function VisibilityBadge({
  visibility,
}: {
  readonly visibility: LibraryItem["visibility"];
}) {
  switch (visibility) {
    case "private":
      return (
        <Badge variant="ghost">
          <LockIcon data-icon="inline-start" />
          <Trans>Private</Trans>
        </Badge>
      );
    case "shared":
      return (
        <Badge variant="ghost">
          <UsersIcon data-icon="inline-start" />
          <Trans>Shared</Trans>
        </Badge>
      );
    case "published":
      return (
        <Badge variant="ghost">
          <UsersIcon data-icon="inline-start" />
          <Trans>In a library</Trans>
        </Badge>
      );
    case "public-link":
      return (
        <Badge variant="ghost">
          <GlobeIcon data-icon="inline-start" />
          <Trans>Public link</Trans>
        </Badge>
      );
    default:
      return visibility satisfies never;
  }
}

export const useAccessLabel = (): ((access: LibraryAccess) => string) => {
  const { t } = useLingui();
  return (access) => {
    switch (access) {
      case "owner":
        return t`Owner`;
      case "maintainer":
        return t`Maintainer`;
      case "edit":
        return t`Can edit`;
      case "view":
        return t`Can view`;
      case "use":
        return t`Can use`;
      default:
        return access satisfies never;
    }
  };
};

/** The caller's level, for items that aren't theirs. */
export function AccessBadge({ access }: { readonly access: LibraryAccess }) {
  const label = useAccessLabel();
  if (access === "owner") {
    return null;
  }
  return <Badge variant="outline">{label(access)}</Badge>;
}

/** A principal's display name from what `me` knows (teams and orgs the caller is in). */
export const usePrincipalName = (
  me: Me | undefined
): ((principal: Principal) => string) => {
  const { t } = useLingui();
  return (principal) => {
    if (principal.type === "user") {
      return principal.id === me?.user.id ? t`You` : t`Someone`;
    }
    if (principal.type === "team") {
      return (
        me?.teams.find((each) => each.team.id === principal.id)?.team.name ??
        t`A team`
      );
    }
    return me?.orgs.find((each) => each.id === principal.id)?.name ?? t`An org`;
  };
};
