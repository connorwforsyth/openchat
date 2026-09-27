import { implement, ORPCError } from "@orpc/server";
import type { KeyStore } from "@workspace/ai/keys/key-store";
import {
  type KeyContext,
  keyedProviders,
  resolveChatKeys,
} from "@workspace/ai/keys/resolve";
import type { ProviderRegistry } from "@workspace/ai/ports/provider-registry";
import { orgRoleOf } from "@workspace/auth/resources";
import type { Env } from "@workspace/config/parse";
import { toPublicConfig } from "@workspace/config/public";
import type { AppConfig } from "@workspace/config/schema";
import { contract } from "@workspace/contract/contract";
import { baseErrors } from "@workspace/contract/errors";
import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import type { ChatContextType } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { teamLineage } from "@workspace/db/queries/teams";
import { teamMember } from "@workspace/db/schema/tenancy";
import { and, eq } from "drizzle-orm";

import type { RequestContext } from "../context";
import type { OrgKeyPolicy } from "../keys/db-key-store";
import {
  checkHealth,
  databaseProbe,
  downProbe,
  type HealthProbes,
} from "./health";

// The `meta` procedure group: the public instance config (no session) and
// the model picker. The picker lists every model the config offers and
// marks each available when a key for its provider resolves in the chosen
// chat context (D17), the same resolution a run uses.

export interface MetaDeps {
  readonly config: AppConfig;
  readonly db: Db;
  /** Where environment-only social sign-in comes from; `process.env` at the shell. */
  readonly env?: Env;
  /** `meta.health`'s probes; by default the database is pinged and jobs report down. */
  readonly health?: HealthProbes;
  readonly keyStore: KeyStore;
  /** The org's effective key policy (`orgKeyPolicy`). */
  readonly orgPolicy: OrgKeyPolicy;
  readonly registry: ProviderRegistry;
}

const forbidden = () => new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);
const missingContextId = () =>
  new ORPCError("VALIDATION", {
    data: {
      issues: [
        {
          message: "A team or org context needs `contextId`.",
          path: ["contextId"],
        },
      ],
    },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

export const createMetaRouter = (deps: MetaDeps) => {
  const { config, db } = deps;
  const os = implement(contract).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    return next({ context: { userId: context.session.userId } });
  });

  /**
   * The context as key resolution needs it, if the caller may pick it: a
   * type the instance allows, and a team or org they belong to (the rule
   * `me.updateSettings` applies to a default context).
   */
  const keyContextFor = async (
    userId: UserId,
    type: ChatContextType,
    id: string | undefined
  ): Promise<KeyContext> => {
    if (!config.policies.chatContext.includes(type)) {
      throw forbidden();
    }
    switch (type) {
      case "personal":
        return { type: "personal", userId };
      case "org": {
        if (!id) {
          throw missingContextId();
        }
        if ((await orgRoleOf(db, id as OrgId, userId)) === null) {
          throw forbidden();
        }
        return { orgId: id as OrgId, type: "org", userId };
      }
      case "team": {
        if (!id) {
          throw missingContextId();
        }
        const [membership, lineage] = await Promise.all([
          db
            .select({ teamId: teamMember.teamId })
            .from(teamMember)
            .where(
              and(
                eq(teamMember.teamId, id as TeamId),
                eq(teamMember.userId, userId)
              )
            ),
          teamLineage(db, id as TeamId),
        ]);
        const [first, ...rest] = lineage?.path ?? [];
        if (!(membership.length > 0 && lineage && first)) {
          throw forbidden();
        }
        return {
          orgId: lineage.orgId,
          teamPath: [first, ...rest],
          type: "team",
          userId,
        };
      }
      default:
        return type satisfies never;
    }
  };

  const probes = deps.health ?? {
    database: databaseProbe(db),
    jobs: downProbe("no job queue"),
  };

  const meta = {
    config: os.meta.config.handler(() =>
      toPublicConfig(config, deps.env ?? {})
    ),

    health: os.meta.health.handler(async ({ errors, input }) => {
      const report = await checkHealth(probes);
      if (input.ready && report.status !== "ok") {
        throw errors.NOT_READY({ data: report });
      }
      return report;
    }),

    models: authed.meta.models.handler(async ({ context, input, signal }) => {
      const keyContext = await keyContextFor(
        context.userId,
        input.contextType,
        input.contextId
      );
      const keys = await resolveChatKeys(
        keyContext,
        deps.keyStore,
        {
          instance: config.policies,
          org:
            keyContext.type === "personal"
              ? null
              : await deps.orgPolicy(keyContext.orgId),
        },
        { signal }
      );
      // A store that can't be read leaves only keyless providers available,
      // which is what a run would find too.
      return [
        ...deps.registry.listModels(
          keys.ok ? keyedProviders(keys.value) : new Set()
        ),
      ];
    }),
  };

  return { meta };
};

/**
 * Just `meta.config` and `meta.health`, for a server running without a
 * database: the sign-in page still needs the brand and the sign-in options
 * to say what's wrong, and healthchecks need to see it's degraded.
 */
export const createPublicConfigRouter = ({
  config,
  env,
  health,
}: Pick<MetaDeps, "config" | "env"> & { readonly health: HealthProbes }) => {
  const os = implement({
    meta: { config: contract.meta.config, health: contract.meta.health },
  }).$context<RequestContext>();
  return os.router({
    meta: {
      config: os.meta.config.handler(() => toPublicConfig(config, env ?? {})),
      health: os.meta.health.handler(async ({ errors, input }) => {
        const report = await checkHealth(health);
        if (input.ready && report.status !== "ok") {
          throw errors.NOT_READY({ data: report });
        }
        return report;
      }),
    },
  });
};
