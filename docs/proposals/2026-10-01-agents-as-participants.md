# Proposal: agents apart from models, as chat participants

_Status (2026-10-01): a proposal for Connor (ticket 108). Nothing here is built._

Connor (2026-10-01): "theoretically you might want to have multiple agents in a chat — not sure if we should decouple agents from models — in my mind it makes sense to — you may have an agent to basically have its own little sandbox almost."

## Today

- **Each turn has one target:** a model or an agent (`RunTarget`). An agent version names its own model, instructions, tools, knowledge and approvals.
- **One picker for both:** models and agents are listed together, so choosing an agent also chooses a model.
- **One workspace per chat:** every turn shares the same sandbox and files (D7).
- **Mentions:** `@agent` mentions exist in the composer. They add the agent as context; they don't make it answer.

## The idea

**A chat has a model. Agents are participants.**

- **The model picker only picks models:** the chat's default model for plain turns (with 105's thinking level and fast mode).
- **Agents are added to a chat** from a participants control in the header, or by `@`-mentioning them in a message. An agent brings its instructions, tools, knowledge and approvals.
  - **Model:** it uses **its own model** if its version pins one, otherwise **the chat's model**. The version can say which.
  - **Who answers:** a message addressed to an agent (`@Research`) is answered by that agent. A message with no address is answered by the chat's model, or by the chat's "lead" agent if one is set.
  - **Showing who answered:** each reply carries its author (already stored as `message.agent`). 107's markers show the switch.
- **Handing off** (later): an agent can call another agent as a tool (`ask_agent`), and its reply comes back inside the first agent's turn.

## Each agent's own workspace

The chat keeps one workspace, and **each agent gets its own folder in it by default** (`/work/agents/<name>/`):
- **Writes:** an agent's file tools are confined to its folder plus anything the person explicitly shares with it, the same confinement mechanism as `/work` today (074).
- **Shared folder:** `/work/shared/` is readable and writable by all agents in the chat, and by the person.
- **The Files panel** shows the folders, with the agent's mark.
- **A full separate sandbox per agent** (its own container) is an option for agents that run servers or risky code. It costs more, and Docker sandboxes are already per chat, so it would be opt-in per agent version.

## Permissions (073)

- Grants are per agent: "always allow `npm test`" for the Builder agent doesn't extend to the Research agent.
- An agent's reach is its folder and the shared folder, and its tools are its version's tools.

## Data and contract

- `RunTarget` keeps `model` and `agent` (no break). New: a conversation's **participants** (agents added to the chat, and an optional lead), and a message's **addressee**. Both are additive.
- **Migration:** existing chats whose default target is an agent get that agent as their lead participant, and the chat's model becomes the agent's model. Nothing visible changes for them.

## Questions for Connor

1. **The split:** does "a chat picks a model, and agents are participants you add or @mention" match what you meant?
2. **A message with no @:** answered by the chat's model, or by a lead agent when the chat has one?
3. **Workspace:** a folder per agent inside the chat's workspace (recommended), or a separate sandbox per agent?
4. **Agent models:** should an agent always use its own model, always the chat's, or should its author choose (recommended)?
5. **Handoff:** do you want agents calling other agents early, or after participants work?
6. **Order:** build this before or after the Artifacts page?
