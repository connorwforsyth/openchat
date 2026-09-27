import { createHash, randomBytes } from "node:crypto";

// Invite-link secrets (Q16). An invitation is accepted with a random token
// the admin passes on; the database keeps only its hash, so the token is
// shown once (in `orgs.invite`'s response) and a database read can't be
// turned into an accepted invitation.

/** 32 random bytes, base64url: 43 characters, fits `invitationTokenSchema`. */
export const newInvitationToken = (): string =>
  randomBytes(32).toString("base64url");

/** What `invitation_token.token_hash` stores. */
export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token).digest("base64url");
