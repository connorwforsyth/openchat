"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";
import { useApi } from "../../_shared/api";
import { KeysManager } from "../../_shared/keys-manager";
import { type Option, OptionSelect } from "../../_shared/option-select";
import { buildTeamTree, flattenTree } from "./team-tree";

// Org and team keys (D17): a team chat uses the team's keys, then its
// parents', then the org's. One page manages each level.

const ORG = "org";

export const OrgKeysAdmin = ({ orgId }: { readonly orgId: OrgId }) => {
  const { t } = useLingui();
  const { query } = useApi();
  const teams = useQuery(query.teams.list.queryOptions({ input: { orgId } }));
  const [owner, setOwner] = useState<string>(ORG);
  const options: readonly Option<string>[] = [
    { label: t`The whole org`, value: ORG },
    ...flattenTree(buildTeamTree(teams.data ?? [])).map((node) => ({
      label: `${"— ".repeat(node.depth)}${node.team.name}`,
      value: node.team.id,
    })),
  ];
  const team = teams.data?.find((each) => each.id === owner);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="keys-owner">
          <Trans>Keys for</Trans>
        </Label>
        <OptionSelect
          className="w-64"
          id="keys-owner"
          onChange={setOwner}
          options={options}
          value={team ? team.id : ORG}
        />
        <p className="text-muted-foreground text-sm">
          {team ? (
            <Trans>
              Used by this team's chats and its sub-teams' when they have none
              of their own.
            </Trans>
          ) : (
            <Trans>
              Used by org chats, and by team chats when no team up the tree has
              a key.
            </Trans>
          )}
        </p>
      </div>
      <KeysManager
        key={team?.id ?? orgId}
        owner={
          team ? { id: team.id, type: "team" } : { id: orgId, type: "org" }
        }
      />
    </div>
  );
};
