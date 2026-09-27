import {
  type AgentDefinition,
  agentDefinitionSchema,
} from "@workspace/contract/schemas/library";
import {
  type ModelSelector,
  modelRefSchema,
} from "@workspace/contract/schemas/models";
import { z } from "zod";

// LibreChat agent import (D13): a LibreChat agent document (the JSON its
// agents API returns) mapped onto our agent definition. Pure. What has no
// counterpart is dropped: file ids and MCP servers belong to the other
// instance, actions are OpenAPI specs we don't run, and an avatar is a URL
// to someone else's storage.

/** LibreChat's own tool names, and ours. Anything else is left out. */
const TOOLS: Readonly<Record<string, string>> = {
  execute_code: "bash",
  file_search: "file_search",
  web_search: "web_search",
};

// LibreChat names MCP tools `tool_mcp_server`; they need the server itself.
const MCP_DELIMITER = "_mcp_";
const PROVIDER = /^[a-z][a-z0-9_-]{0,63}$/;

const trimmed = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => (value ?? "").trim().slice(0, max));

const libreChatAgentSchema = z.looseObject({
  conversation_starters: z.array(z.string()).nullish(),
  description: trimmed(2000),
  instructions: trimmed(100_000),
  model: z.string().nullish(),
  model_parameters: z
    .looseObject({
      frequency_penalty: z.number().min(-2).max(2).nullish(),
      max_output_tokens: z.int().min(1).nullish(),
      max_tokens: z.int().min(1).nullish(),
      maxOutputTokens: z.int().min(1).nullish(),
      presence_penalty: z.number().min(-2).max(2).nullish(),
      temperature: z.number().min(0).max(2).nullish(),
      top_p: z.number().min(0).max(1).nullish(),
      topP: z.number().min(0).max(1).nullish(),
    })
    .nullish(),
  name: z.string().trim().min(1).max(200),
  provider: z.string().nullish(),
  tools: z.array(z.string()).nullish(),
});

/** `provider:model` when both make a valid ref, else the fallback (`models.default`). */
const modelOf = (
  provider: string | null | undefined,
  model: string | null | undefined,
  fallback: ModelSelector
): ModelSelector => {
  const id = provider?.trim().toLowerCase();
  if (!(id && model && PROVIDER.test(id))) {
    return fallback;
  }
  const ref = modelRefSchema.safeParse(`${id}:${model.trim()}`);
  return ref.success ? ref.data : fallback;
};

const defined = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, each]) => each !== undefined && each !== null
    )
  ) as Partial<T>;

export interface MappedAgent {
  readonly definition: AgentDefinition;
  readonly description: string;
  readonly icon: string | null;
  readonly name: string;
}

/** Parses a LibreChat agent and maps it; the error is zod's, for `VALIDATION`. */
export const libreChatAgentToDefinition = (
  data: unknown,
  fallbackModel: ModelSelector
) =>
  libreChatAgentSchema
    .transform((agent): MappedAgent => {
      const params = agent.model_parameters ?? {};
      const tools = [
        ...new Set(
          (agent.tools ?? []).flatMap((name) =>
            name.includes(MCP_DELIMITER) || !(name in TOOLS)
              ? []
              : [TOOLS[name] as string]
          )
        ),
      ];
      const definition = agentDefinitionSchema.parse({
        conversationStarters: (agent.conversation_starters ?? [])
          .map((starter) => starter.trim().slice(0, 500))
          .filter((starter) => starter.length > 0)
          .slice(0, 8),
        instructions: agent.instructions,
        kind: "agent",
        model: modelOf(agent.provider, agent.model, fallbackModel),
        parameters: defined({
          frequencyPenalty: params.frequency_penalty,
          maxOutputTokens:
            params.maxOutputTokens ??
            params.max_output_tokens ??
            params.max_tokens,
          presencePenalty: params.presence_penalty,
          temperature: params.temperature,
          topP: params.topP ?? params.top_p,
        }),
        sandboxProvider: tools.includes("bash") ? "just-bash" : null,
        tools,
      });
      return {
        definition,
        description: agent.description,
        icon: null,
        name: agent.name,
      };
    })
    .safeParse(data);
