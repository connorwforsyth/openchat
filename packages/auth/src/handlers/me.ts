import type { UserId } from "@workspace/contract/schemas/common";
import type { UserSettings } from "@workspace/contract/schemas/meta";
import {
  type ChatContext,
  teamRoleSchema,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  member,
  organization,
  user,
  userSettings,
} from "@workspace/db/schema/auth";
import { team, teamMember } from "@workspace/db/schema/tenancy";
import { and, asc, eq } from "drizzle-orm";

import { strongestOrgRole } from "../access";
import { orgRoleOf } from "../resources";
import { findPersonalOrgId } from "../store";
import { authed } from "./base";
import { toOrg, toTeam, urlOrNull } from "./views";

// The signed-in user: who they are, where they belong, and their defaults.

const isInstanceAdmin = (role: string | null): boolean =>
  (role ?? "").split(",").some((each) => each.trim() === "admin");

const loadUser = async (db: Db, id: UserId) => {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  if (!row) {
    // The session outlived its user: a bug or a race with deletion.
    throw new Error("session user not found");
  }
  return row;
};

const loadSettings = async (db: Db, id: UserId): Promise<UserSettings> => {
  const [row] = await db
    .select({ locale: user.locale, settings: userSettings })
    .from(user)
    .leftJoin(userSettings, eq(userSettings.userId, user.id))
    .where(eq(user.id, id));
  return {
    defaultContext: row?.settings?.defaultContext ?? { type: "personal" },
    defaultTarget: row?.settings?.defaultTarget ?? null,
    locale: row?.locale ?? null,
  };
};

/** Whether the user may pick `context` at all: Personal, or a team or org they're in. */
const canUseContext = async (
  db: Db,
  userId: UserId,
  context: ChatContext
): Promise<boolean> => {
  switch (context.type) {
    case "personal":
      return true;
    case "org":
      return (await orgRoleOf(db, context.id, userId)) !== null;
    case "team": {
      const [row] = await db
        .select({ teamId: teamMember.teamId })
        .from(teamMember)
        .where(
          and(eq(teamMember.teamId, context.id), eq(teamMember.userId, userId))
        );
      return row !== undefined;
    }
    default:
      return context satisfies never;
  }
};

export const me = {
  get: authed.me.get.handler(async ({ context }) => {
    const [row, personalOrgId, orgRows, teamRows] = await Promise.all([
      loadUser(context.db, context.userId),
      findPersonalOrgId(context.db, context.userId),
      context.db
        .select({ member, organization })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, context.userId))
        .orderBy(asc(organization.createdAt), asc(organization.id)),
      context.db
        .select({ role: teamMember.role, team })
        .from(teamMember)
        .innerJoin(team, eq(team.id, teamMember.teamId))
        .where(eq(teamMember.userId, context.userId))
        .orderBy(asc(team.createdAt), asc(team.id)),
    ]);
    if (!personalOrgId) {
      // Every user gets one at sign-up (`bootstrapUser`).
      throw new Error("user has no personal org");
    }
    return {
      // Personal included, flagged `isPersonal`: the one call that shows everything.
      orgs: orgRows.map((each) =>
        toOrg(each.organization, strongestOrgRole(each.member.role) ?? "member")
      ),
      personalOrgId,
      teams: teamRows.map((each) => ({
        role: teamRoleSchema.parse(each.role),
        team: toTeam(each.team),
      })),
      user: {
        email: row.email,
        id: row.id,
        image: urlOrNull(row.image),
        isAdmin: isInstanceAdmin(row.role),
        locale: row.locale,
        name: row.name,
      },
    };
  }),

  settings: authed.me.settings.handler(({ context }) =>
    loadSettings(context.db, context.userId)
  ),

  updateSettings: authed.me.updateSettings.handler(
    async ({ context, errors, input }) => {
      if (
        input.defaultContext &&
        !(await canUseContext(context.db, context.userId, input.defaultContext))
      ) {
        throw errors.FORBIDDEN();
      }
      await context.db.transaction(async (tx) => {
        if (input.locale !== undefined) {
          await tx
            .update(user)
            .set({ locale: input.locale })
            .where(eq(user.id, context.userId));
        }
        const patch = {
          ...(input.defaultContext === undefined
            ? {}
            : { defaultContext: input.defaultContext }),
          ...(input.defaultTarget === undefined
            ? {}
            : { defaultTarget: input.defaultTarget }),
        };
        if (Object.keys(patch).length > 0) {
          await tx
            .insert(userSettings)
            .values({ userId: context.userId, ...patch })
            .onConflictDoUpdate({ set: patch, target: userSettings.userId });
        }
      });
      return loadSettings(context.db, context.userId);
    }
  ),
};
