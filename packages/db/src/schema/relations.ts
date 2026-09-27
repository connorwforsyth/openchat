import { defineRelations } from "drizzle-orm";

import { resourceGrant, shareLink } from "./access";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  userSettings,
  verification,
} from "./auth";
import {
  conversation,
  conversationParticipant,
  message,
  run,
  runChunk,
} from "./chat";
import { artifact, artifactVersion, file, fileChunk, skillFile } from "./files";
import {
  agent,
  agentVersion,
  mcpOauthToken,
  mcpServer,
  preset,
  prompt,
  promptVersion,
  skill,
  skillVersion,
} from "./library";
import { memory, memoryVersion } from "./memory";
import {
  decisionLog,
  evalCase,
  evalDataset,
  evalResult,
  evalRun,
  feedback,
  qualityScore,
} from "./quality";
import { sandbox } from "./sandbox";
import {
  budget,
  invitationTeam,
  invitationToken,
  orgSettings,
  team,
  teamMember,
} from "./tenancy";
import { balance, providerKey, transaction } from "./usage";

// Relational queries (Drizzle 1.0 RQB v2). Drizzle 1.0 takes `relations`, not
// `schema` (docs/decisions/0001). Better Auth's part mirrors what `auth
// generate` emits for `@better-auth/drizzle-adapter/relations-v2`; keep it in
// step when the auth plugins change. Polymorphic links (grants, owners,
// contexts) have no relation: they're resolved in the query modules.

const tables = {
  account,
  agent,
  agentVersion,
  artifact,
  artifactVersion,
  balance,
  budget,
  conversation,
  conversationParticipant,
  decisionLog,
  evalCase,
  evalDataset,
  evalResult,
  evalRun,
  feedback,
  file,
  fileChunk,
  invitation,
  invitationTeam,
  invitationToken,
  mcpOauthToken,
  mcpServer,
  member,
  memory,
  memoryVersion,
  message,
  organization,
  orgSettings,
  preset,
  prompt,
  promptVersion,
  providerKey,
  qualityScore,
  resourceGrant,
  run,
  runChunk,
  sandbox,
  session,
  shareLink,
  skill,
  skillFile,
  skillVersion,
  team,
  teamMember,
  transaction,
  user,
  userSettings,
  verification,
};

export const relations = defineRelations(tables, (r) => ({
  // --- Better Auth ---
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id }),
  },

  // --- Library ---
  agent: {
    versions: r.many.agentVersion({
      from: r.agent.id,
      to: r.agentVersion.itemId,
    }),
  },
  agentVersion: {
    agent: r.one.agent({ from: r.agentVersion.itemId, to: r.agent.id }),
  },

  // --- Files ---
  artifact: {
    conversation: r.one.conversation({
      from: r.artifact.conversationId,
      to: r.conversation.id,
    }),
    versions: r.many.artifactVersion({
      from: r.artifact.id,
      to: r.artifactVersion.artifactId,
    }),
  },
  artifactVersion: {
    artifact: r.one.artifact({
      from: r.artifactVersion.artifactId,
      to: r.artifact.id,
    }),
  },

  // --- Chat ---
  conversation: {
    artifacts: r.many.artifact({
      from: r.conversation.id,
      to: r.artifact.conversationId,
    }),
    messages: r.many.message({
      from: r.conversation.id,
      to: r.message.conversationId,
    }),
    owner: r.one.user({ from: r.conversation.ownerId, to: r.user.id }),
    participants: r.many.conversationParticipant({
      from: r.conversation.id,
      to: r.conversationParticipant.conversationId,
    }),
    runs: r.many.run({ from: r.conversation.id, to: r.run.conversationId }),
    sandbox: r.one.sandbox({
      from: r.conversation.id,
      to: r.sandbox.conversationId,
    }),
  },
  conversationParticipant: {
    conversation: r.one.conversation({
      from: r.conversationParticipant.conversationId,
      to: r.conversation.id,
    }),
    user: r.one.user({
      from: r.conversationParticipant.userId,
      to: r.user.id,
    }),
  },
  evalCase: {
    dataset: r.one.evalDataset({
      from: r.evalCase.datasetId,
      to: r.evalDataset.id,
    }),
  },
  evalDataset: {
    agent: r.one.agent({ from: r.evalDataset.agentId, to: r.agent.id }),
    cases: r.many.evalCase({
      from: r.evalDataset.id,
      to: r.evalCase.datasetId,
    }),
    runs: r.many.evalRun({ from: r.evalDataset.id, to: r.evalRun.datasetId }),
  },
  evalResult: {
    case: r.one.evalCase({ from: r.evalResult.caseId, to: r.evalCase.id }),
    run: r.one.evalRun({ from: r.evalResult.runId, to: r.evalRun.id }),
  },
  evalRun: {
    dataset: r.one.evalDataset({
      from: r.evalRun.datasetId,
      to: r.evalDataset.id,
    }),
    results: r.many.evalResult({
      from: r.evalRun.id,
      to: r.evalResult.runId,
    }),
  },
  feedback: {
    message: r.one.message({ from: r.feedback.messageId, to: r.message.id }),
    user: r.one.user({ from: r.feedback.userId, to: r.user.id }),
  },
  file: {
    chunks: r.many.fileChunk({ from: r.file.id, to: r.fileChunk.fileId }),
    owner: r.one.user({ from: r.file.ownerId, to: r.user.id }),
  },
  fileChunk: {
    file: r.one.file({ from: r.fileChunk.fileId, to: r.file.id }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
    }),
    teams: r.many.invitationTeam({
      from: r.invitation.id,
      to: r.invitationTeam.invitationId,
    }),
    user: r.one.user({ from: r.invitation.inviterId, to: r.user.id }),
  },

  // --- Tenancy ---
  invitationTeam: {
    invitation: r.one.invitation({
      from: r.invitationTeam.invitationId,
      to: r.invitation.id,
    }),
    team: r.one.team({ from: r.invitationTeam.teamId, to: r.team.id }),
  },
  mcpOauthToken: {
    mcpServer: r.one.mcpServer({
      from: r.mcpOauthToken.mcpServerId,
      to: r.mcpServer.id,
    }),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({ from: r.member.userId, to: r.user.id }),
  },
  memory: {
    versions: r.many.memoryVersion({
      from: r.memory.userId,
      to: r.memoryVersion.userId,
    }),
  },
  message: {
    author: r.one.user({ from: r.message.authorId, to: r.user.id }),
    conversation: r.one.conversation({
      from: r.message.conversationId,
      to: r.conversation.id,
    }),
    feedback: r.many.feedback({ from: r.message.id, to: r.feedback.messageId }),
    run: r.one.run({ from: r.message.runId, to: r.run.id }),
  },
  organization: {
    invitations: r.many.invitation({
      from: r.organization.id,
      to: r.invitation.organizationId,
    }),
    members: r.many.member({
      from: r.organization.id,
      to: r.member.organizationId,
    }),
    settings: r.one.orgSettings({
      from: r.organization.id,
      to: r.orgSettings.orgId,
    }),
    teams: r.many.team({ from: r.organization.id, to: r.team.orgId }),
  },
  orgSettings: {
    organization: r.one.organization({
      from: r.orgSettings.orgId,
      to: r.organization.id,
    }),
  },
  prompt: {
    versions: r.many.promptVersion({
      from: r.prompt.id,
      to: r.promptVersion.itemId,
    }),
  },
  promptVersion: {
    prompt: r.one.prompt({ from: r.promptVersion.itemId, to: r.prompt.id }),
  },
  run: {
    chunks: r.many.runChunk({ from: r.run.id, to: r.runChunk.runId }),
    conversation: r.one.conversation({
      from: r.run.conversationId,
      to: r.conversation.id,
    }),
    userMessage: r.one.message({
      from: r.run.userMessageId,
      to: r.message.id,
    }),
  },
  runChunk: {
    run: r.one.run({ from: r.runChunk.runId, to: r.run.id }),
  },

  // --- Sandbox, memory, quality ---
  sandbox: {
    conversation: r.one.conversation({
      from: r.sandbox.conversationId,
      to: r.conversation.id,
    }),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id }),
  },
  skill: {
    versions: r.many.skillVersion({
      from: r.skill.id,
      to: r.skillVersion.itemId,
    }),
  },
  skillFile: {
    file: r.one.file({ from: r.skillFile.fileId, to: r.file.id }),
    skillVersion: r.one.skillVersion({
      from: r.skillFile.skillVersionId,
      to: r.skillVersion.id,
    }),
  },
  skillVersion: {
    files: r.many.skillFile({
      from: r.skillVersion.id,
      to: r.skillFile.skillVersionId,
    }),
    skill: r.one.skill({ from: r.skillVersion.itemId, to: r.skill.id }),
  },
  team: {
    children: r.many.team({
      alias: "team_parent",
      from: r.team.id,
      to: r.team.parentId,
    }),
    members: r.many.teamMember({ from: r.team.id, to: r.teamMember.teamId }),
    organization: r.one.organization({
      from: r.team.orgId,
      to: r.organization.id,
    }),
    parent: r.one.team({
      alias: "team_parent",
      from: r.team.parentId,
      to: r.team.id,
    }),
  },
  teamMember: {
    team: r.one.team({ from: r.teamMember.teamId, to: r.team.id }),
    user: r.one.user({ from: r.teamMember.userId, to: r.user.id }),
  },
  user: {
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    conversations: r.many.conversation({
      from: r.user.id,
      to: r.conversation.ownerId,
    }),
    invitations: r.many.invitation({
      from: r.user.id,
      to: r.invitation.inviterId,
    }),
    members: r.many.member({ from: r.user.id, to: r.member.userId }),
    memory: r.one.memory({ from: r.user.id, to: r.memory.userId }),
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    settings: r.one.userSettings({
      from: r.user.id,
      to: r.userSettings.userId,
    }),
    teamMembers: r.many.teamMember({
      from: r.user.id,
      to: r.teamMember.userId,
    }),
  },
}));

export type Relations = typeof relations;
