---
id: "190"
title: "Spaces: which roles?"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

Owner, admin, member, viewer?

## Resolution (2026-10-20, loop, AFK)

**owner, admin, member.** Root spaces use the org roles as they are. A sub-space has team roles; its `admin` is shown as the sub-space **owner** (no new stored role, so no migration of `team_member_role`). Owners add members (who must already be in the root space), promote them to owner, demote and remove. No viewer role: `viewer` is a per-chat permission (D25), not a space role.

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
