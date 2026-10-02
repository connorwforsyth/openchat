# The tool registry

One shape for every tool a run can be given, and one file per built-in tool
(ticket 080, from the eve assessment's S2). We copied the pattern, not the
package: nothing here depends on eve or on a Vercel service.

## The shape

`defineTool` (`define.ts`) takes a name, a description, a zod `input`, an
optional zod `output`, and `execute(input, ctx)`. It can also carry:

- `approval`: the tool's default, `auto` or `ask`.
- `capability`: what the instance or the run must have for the tool to be offered.
- `modelText`: what the model reads instead of the result's JSON.

`ctx` is ours, not the AI SDK's:

| Part | What it is | Bound |
|---|---|---|
| `actor` | Who the tool acts for | Per run |
| `conversation` | The chat, and the run and answer the call belongs to | Per run |
| `workspace` | The chat's sandbox; `@workspace/sandbox` types it | Per run |
| `ports` | What the tool's own file asks for (a store, a search backend) | Per run |
| `emit` | Reports progress (`bash` output as it arrives) | Per run |
| `signal` | Aborts when the run is stopped or times out | Per call |
| `toolCallId` | The call's id | Per call |

A definition names the parts it needs by typing its `ctx`, and then
`toAiSdkTool(definition, run)` won't compile without them.

`toAiSdkTool` (`to-ai-sdk.ts`) is the only place a definition meets the AI
SDK. It returns what `ToolLoopAgent` takes.

MCP and client tools are adapted into the same shape in `adapt.ts`:

- A client tool has no `execute`, so the run stops at its call.
- An MCP tool keeps the tool `@ai-sdk/mcp` built, and `toAiSdkTool` hands it
  back unchanged.

## Where things live, and why

Packages depend in one direction: `sandbox` → `server` → `mcp` → `ai`. So
`@workspace/ai` can't import the sandbox or the server. That decides the layout:

| What | Where |
|---|---|
| `defineTool`, `ToolContext`, `toAiSdkTool`, the adapters, `createToolRegistry` | here |
| `file_search`, `web_search`, `update_memory`, `create_artifact`, `update_artifact`, `generate_image`, `load_skill`, `create_skill`, `update_skill`, `publish_skill` | here, one file each |
| `bash`, `read`, `write`, `edit`, `preview` | `packages/sandbox/src/tools/defs/`, one file each |
| The registry of all fourteen (`builtinTools`) | `packages/sandbox/src/tools/registry.ts` |

The sandbox tools need the `Sandbox` port and the `/work` path rule, which
live in `@workspace/sandbox`. That package is also the first one that can see
every built-in, so the whole registry is assembled there. `index.ts` here
holds `aiBuiltinTools`, the ten this package can see.

Files are kebab-case (`file-search.ts` for `file_search`) because the lint
rule says so. `index.ts` builds a map; it isn't a barrel. To bind a tool,
import its own file, which keeps its types.

What two tools share sits beside the definitions, not in them:

- `../artifact-content.ts` for the two artifact tools. What an artifact of
  each kind may contain is not theirs to say: each kind is a definition in
  `@workspace/artifacts-kit` (ticket 123), and a save runs that kind's checks.
  A failed check is an `invalid` result the model reads, and nothing is
  saved. `artifact-golden.test.ts` here pins the two tools and which content
  each kind accepts.
- `image-generation.ts` for `generate_image` (138): drawing through the AI
  SDK's `generateImage`, the workspace file and `image` artifact each picture
  becomes, and what the model reads.
- `skill-authoring.ts` for the three skill tools (128): their schemas, the
  `SkillAuthoringPorts` the server binds (`server/src/library/skill-authoring.ts`,
  which runs the Library's own handlers as the person), and the text the
  model reads. `skill-tools.ts` binds all three to one run's ports.
- `workspace.ts` and `file-change.ts` in the sandbox package for its five.

`file_search`'s search and schemas stay in `rag/file-search.ts`, which the
`files.search` handler also uses.

## Approval defaults

`approval` is a declarative default and nothing else. It says what the tool
does today when nobody has said otherwise:

| Tool | Default | Today's source of that behaviour |
|---|---|---|
| `read`, `bash`, `preview` | `auto` | `chatSandboxApproval` |
| `write`, `edit` | `ask` | `FILE_CHANGE_TOOLS` in `server/src/runs/sandbox.ts` |
| `create_artifact`, `update_artifact` | `ask` | `ARTIFACT_APPROVALS` in `server/src/runs/turn.ts` |
| `generate_image` | `ask` | `chatImageTools` in `server/src/runs/turn.ts`; `models.image.approval: auto` runs it without asking (138) |
| `file_search`, `web_search` | `auto` | The plain chat gives them no approval entry |
| `update_memory` | `auto` | `withMemory`; a user in `propose` mode is asked |
| `create_skill`, `update_skill` | `ask` | `chatSkillTools` and `SKILL_APPROVALS` in `server/src/runs/turn.ts`; an agent may set them to `auto` |
| `publish_skill` | `ask` | The same; the turn holds it to `ask` even under an agent that says `auto` |
| `load_skill` | `auto` | `skillTools` in `server/src/runs/skills.ts`; it only reads skills the turn was given |
| MCP tools | `ask` | `chatMcpTools`; an agent's own approvals apply instead |
| Client tools | `auto` | `buildToolSet`; the client decides for itself |

Nothing reads these to decide a call. The turn resolver, `resolveTools` and
`withMemory` still decide exactly as before, and the policy engine in the
permissions proposal is not decided or built here. The registry gives it one
place to read defaults from. Two tests hold the defaults to the wiring:
`registry.test.ts` here, and `registry.test.ts` beside the sandbox registry,
which also checks them against the golden snapshot.

## The old factories

These stay for one release as thin wrappers with the same names and
signatures, so callers and tests didn't change:

- `createSandboxTools` (`@workspace/sandbox/tools/tools`)
- `createWebSearchTool` (`search/web-search-tool`)
- `createUpdateMemoryTool` (`memory/tool`)
- `createArtifactTools` (`tools/artifacts`)
- `clientTool` (`tools/tool-set`)
- `fileSearchToolFor` (`@workspace/server/knowledge/file-search-tool`)

Each binds a definition with `toAiSdkTool`. The modules they live in also
still export what used to be written there.

One exception: `createFileSearchTool` in `rag/file-search.ts` is unchanged,
not a wrapper, because that file was outside what 080 owned. Nothing in a run
calls it now. `registry.test.ts` holds it and the definition to the same
description, schemas and results until it's deleted.

## The golden snapshot

`packages/sandbox/src/tools/__snapshots__/tool-golden.json.snap` records
every tool a run can be given: its name, description and input schema as the
model is sent them, and its approval as the executor gets it. It was
committed before the registry existed and must not change when a tool moves.
If a change to a tool is intended, change the snapshot in the same commit and
say so.

## Adding a built-in

1. Write `your-tool.ts` with `defineTool`, in this folder or in the package
   that owns the ports it needs.
2. Add it to the list in `index.ts` (or the sandbox's `registry.ts`).
3. Bind it where the turn resolver builds its tools, with `toAiSdkTool`.
4. Update the golden snapshot, which will now list it.
