import type { RunStart } from "@workspace/ai/ports/run-executor";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Db } from "@workspace/db/client";
import {
  getArtifact,
  getArtifactVersion,
  saveArtifactVersion,
} from "@workspace/db/queries/artifacts";
import { getMessage, updateMessage } from "@workspace/db/queries/messages";
import { err, ok, type Result } from "@workspace/shared/result";

import {
  isPlanKind,
  PLAN_APPROVAL_DATA,
  PLAN_DATA,
  type PlanApproval,
  type PlanRef,
  planApprovalOf,
  planText,
  planTitle,
} from "./plan-mode";

// Plan mode's I/O (106), over the existing artifact store: a planning run's
// answer saved as a Document (126; plans from before were markdown and
// still work), and an approval pinned to the version it approves. The rules
// are in `plan-mode.ts`.

/**
 * Saves a planning run's answer as a "Plan: …" Document in its chat, and
 * returns the answer's parts with a `plan` data part pointing at it, which
 * the chat shows as the plan card. An answer with no prose has no plan to
 * save. Saving is an extra: on failure the answer stands.
 */
export const savePlan = async (
  db: Db,
  run: Pick<RunStart, "conversationId" | "userMessageId">,
  assistantMessageId: MessageId,
  parts: readonly MessagePart[]
): Promise<Result<readonly MessagePart[], unknown>> => {
  const content = planText(parts);
  if (content === "") {
    return ok(parts);
  }
  const asked = await getMessage(db, run.userMessageId);
  const request = asked.ok ? planText(asked.value.parts) : "";
  const saved = await saveArtifactVersion(db, {
    content: builtinArtifactKinds.fromModel("document", content),
    conversationId: run.conversationId,
    kind: "document",
    messageId: assistantMessageId,
    title: planTitle(content, request),
  });
  if (!saved.ok) {
    return err(saved.error);
  }
  const ref: PlanRef = {
    artifactId: saved.value.artifact.id,
    title: saved.value.artifact.title,
    versionId: saved.value.version.id,
  };
  return ok([...parts, { data: ref, name: PLAN_DATA, type: "data" }]);
};

export type PinPlanError =
  | { readonly type: "not_found" }
  | { readonly type: "not_a_plan" };

const approvalPart = (
  approval: Required<Pick<PlanApproval, "artifactId" | "versionId">>
): MessagePart => ({
  data: { artifactId: approval.artifactId, versionId: approval.versionId },
  name: PLAN_APPROVAL_DATA,
  type: "data",
});

/**
 * Pins a message's plan approval to one version of the plan before its run
 * starts: the person's edits, saved as a new version made by that message,
 * or else the plan's latest version. The stored part then names that
 * version and drops the edited text. Only a plan (a Document, or a markdown
 * artifact from before 126) in the same chat can be approved; a Document's
 * edits come as its JSON (or Markdown) and must pass its checks. A message
 * without an approval is left alone.
 */
export const pinPlanApproval = async (
  db: Db,
  message: {
    readonly conversationId: RunStart["conversationId"];
    readonly id: MessageId;
    readonly parts: readonly MessagePart[];
  }
): Promise<Result<PlanApproval | null, PinPlanError>> => {
  const approval = planApprovalOf(message.parts);
  if (!approval) {
    return ok(null);
  }
  const found = await getArtifact(db, approval.artifactId);
  if (!found.ok || found.value.conversationId !== message.conversationId) {
    return err({ type: "not_found" });
  }
  const { kind } = found.value;
  if (!isPlanKind(kind)) {
    return err({ type: "not_a_plan" });
  }
  let versionId = found.value.latestVersionId;
  if (approval.content !== undefined) {
    const content = builtinArtifactKinds.fromModel(kind, approval.content);
    if (builtinArtifactKinds.check(kind, content).length > 0) {
      return err({ type: "not_a_plan" });
    }
    const saved = await saveArtifactVersion(db, {
      artifactId: found.value.id,
      content,
      conversationId: message.conversationId,
      kind,
      messageId: message.id,
      title: found.value.title,
    });
    if (!saved.ok) {
      return err({ type: "not_found" });
    }
    versionId = saved.value.version.id;
  }
  if (versionId === null) {
    return err({ type: "not_found" });
  }
  const pinned = { artifactId: found.value.id, versionId };
  const parts = message.parts.map((part) =>
    part.type === "data" && part.name === PLAN_APPROVAL_DATA
      ? approvalPart(pinned)
      : part
  );
  const updated = await updateMessage(db, message.id, { parts });
  return updated.ok ? ok(pinned) : err({ type: "not_found" });
};

/**
 * The approved plan's text for the run answering `userMessageId`: the
 * version its approval was pinned to. A run that starts before the pin
 * lands (a queued run started the moment the one ahead ended) reads the
 * edits the message carries, or else the plan's latest version.
 * `undefined` when the message approves nothing, or the plan is gone.
 */
export const approvedPlanFor = async (
  db: Db,
  run: Pick<RunStart, "conversationId" | "userMessageId">
): Promise<string | undefined> => {
  const message = await getMessage(db, run.userMessageId);
  const approval = message.ok ? planApprovalOf(message.value.parts) : null;
  if (!approval) {
    return;
  }
  const artifact = await getArtifact(db, approval.artifactId);
  if (!artifact.ok || artifact.value.conversationId !== run.conversationId) {
    return;
  }
  // The model reads a Document's plan as Markdown (126).
  const { kind } = artifact.value;
  const asText = (stored: string) => builtinArtifactKinds.toModel(kind, stored);
  if (!approval.versionId && approval.content !== undefined) {
    return asText(builtinArtifactKinds.fromModel(kind, approval.content));
  }
  const versionId = approval.versionId ?? artifact.value.latestVersionId;
  if (!versionId) {
    return;
  }
  const version = await getArtifactVersion(db, approval.artifactId, versionId);
  return version.ok ? asText(version.value.content) : undefined;
};
