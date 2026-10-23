// Placeholders an agent's instructions may hold, filled in on every turn
// (D13): the agent builder's `/` menu offers them and the server replaces
// them before the model reads the instructions. Anything else in braces is
// left as written, so an instruction can still show `{{name}}` literally.

export const AGENT_VARIABLES = ["current_date", "current_user"] as const;

export type AgentVariable = (typeof AGENT_VARIABLES)[number];

export type AgentVariableValues = Readonly<Record<AgentVariable, string>>;

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

const isAgentVariable = (name: string): name is AgentVariable =>
  (AGENT_VARIABLES as readonly string[]).includes(name);

/** `{{current_date}}` and the rest replaced by `values`, in one pass. */
export const fillAgentVariables = (
  instructions: string,
  values: AgentVariableValues
): string =>
  instructions.replace(PLACEHOLDER, (match, name: string) =>
    isAgentVariable(name) ? values[name] : match
  );
