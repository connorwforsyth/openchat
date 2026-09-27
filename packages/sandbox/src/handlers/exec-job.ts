import {
  sandboxIdSchema,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import { execInputSchema } from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import { loadPrincipals } from "@workspace/db/queries/teams";
import type { JobHandler } from "@workspace/server/ports/job-queue";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import type { z } from "zod";

import type { OutputChunk, Sandbox, SandboxError } from "../ports/sandbox";
import { authorizeSandboxExec } from "./sandbox";

// Long-running sandbox work (installs, builds, test suites) as a background
// job (D7), so it survives the tab closing. The job registry registers this
// handler under `SANDBOX_EXEC_JOB`; the result lands as the job's output,
// and output streams to whoever listens.
//
// Job data is only as trustworthy as whatever enqueued it, and the job may
// run well after the request (or a retry after that), so the handler parses
// the data itself and checks the requester may still run commands in the
// sandbox before touching it.

export const SANDBOX_EXEC_JOB = "sandbox.exec";

export const sandboxExecJobDataSchema = execInputSchema.extend({
  /** Who asked; the job acts with their access, checked again when it runs. */
  requestedBy: userIdSchema,
  sandboxId: sandboxIdSchema,
});
export type SandboxExecJobData = z.infer<typeof sandboxExecJobDataSchema>;

export interface SandboxExecJobDeps {
  /** Finds the live sandbox (usually the provider factory's `attach`). */
  readonly attach: (
    id: SandboxExecJobData["sandboxId"]
  ) => AsyncResult<Sandbox, SandboxError>;
  readonly db: Db;
  /** Streams output, e.g. into a `StreamChannel` the panel follows. */
  readonly onOutput?: (data: SandboxExecJobData, chunk: OutputChunk) => void;
}

const describe = (error: SandboxError): string =>
  error.type === "unavailable" || error.type === "limit_exceeded"
    ? error.message
    : error.type;

export const createSandboxExecJobHandler =
  ({
    attach,
    db,
    onOutput,
  }: SandboxExecJobDeps): JobHandler<SandboxExecJobData> =>
  async (job, signal) => {
    const data = sandboxExecJobDataSchema.safeParse(job.data);
    if (!data.success) {
      return err("invalid sandbox job data");
    }
    const { requestedBy, sandboxId } = data.data;
    const session = {
      principals: await loadPrincipals(db, requestedBy),
      userId: requestedBy,
    };
    const allowed = await authorizeSandboxExec({ db, session }, sandboxId);
    if (!allowed.ok) {
      // Gone, or no longer theirs to run in: fail without running anything.
      return err(allowed.error.type);
    }
    const sandbox = await attach(sandboxId);
    if (!sandbox.ok) {
      // pg-boss retries: the runner may be back by then.
      return err(describe(sandbox.error));
    }
    const result = await sandbox.value.exec(data.data.command, {
      cwd: data.data.cwd,
      env: data.data.env,
      onOutput: onOutput ? (chunk) => onOutput(data.data, chunk) : undefined,
      signal,
      timeoutMs: data.data.timeoutMs,
    });
    return result.ok ? ok({ ...result.value }) : err(describe(result.error));
  };
