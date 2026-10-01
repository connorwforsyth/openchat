import {
  libraryItemIdSchema,
  libraryVersionIdSchema,
  nameSchema,
} from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { z } from "zod";

// The skills a message used (127). The composer sends the picks as the
// run's `input.skills`; the server checks each one and keeps what it
// resolved on the stored user message as a `skills` data part, so history
// shows which skills a message used and a regenerate reads them back. The
// contract leaves a data part's shape to the feature that writes it, so this
// is that shape. A client may show its own copy (without versions) while the
// message is on its way; the server drops any it's sent and writes its own.

/** The data part name: `data-skills` in AI SDK terms. */
export const SKILLS_DATA = "skills";

export const skillUseSchema = z.object({
  id: libraryItemIdSchema,
  name: nameSchema,
  /** The published version the turn read; absent on a client's own copy. */
  versionId: libraryVersionIdSchema.optional(),
});
export type SkillUse = z.infer<typeof skillUseSchema>;

export const skillsDataSchema = z.object({
  skills: z.array(skillUseSchema).min(1).max(20),
});
export type SkillsData = z.infer<typeof skillsDataSchema>;

/** The skills a message's parts say it used, first part first, once each. Pure. */
export const skillUsesOf = (
  parts: readonly Pick<MessagePart, "type">[]
): readonly SkillUse[] => {
  const seen = new Set<string>();
  return parts.flatMap((part) => {
    if (part.type !== "data") {
      return [];
    }
    const data = part as Extract<MessagePart, { type: "data" }>;
    if (data.name !== SKILLS_DATA) {
      return [];
    }
    const parsed = skillsDataSchema.safeParse(data.data);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.skills.filter((skill) => {
      if (seen.has(skill.id)) {
        return false;
      }
      seen.add(skill.id);
      return true;
    });
  });
};

/** A message's parts without any `skills` data part: the server writes its own. Pure. */
export const withoutSkillsData = <P extends Pick<MessagePart, "type">>(
  parts: readonly P[]
): P[] =>
  parts.filter(
    (part) =>
      part.type !== "data" ||
      (part as unknown as { readonly name: string }).name !== SKILLS_DATA
  );

/** The data part that records `skills` on a message. Pure. */
export const skillsDataPart = (
  skills: readonly SkillUse[]
): Extract<MessagePart, { type: "data" }> => ({
  data: { skills: skills.map((skill) => ({ ...skill })) },
  name: SKILLS_DATA,
  type: "data",
});
