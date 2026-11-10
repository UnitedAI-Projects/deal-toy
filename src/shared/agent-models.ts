/* The models the built-in agent can run on. Claude runs through Cloudflare AI Gateway (the
   Worker's AI binding, billed through Unified Billing or a key stored on the gateway); Llama
   runs on Workers AI. Shared by the server and the model selector. */
export const AGENT_MODELS = [
  {
    id: "claude-opus-5.5",
    label: "Claude Opus 5.5",
    via: "Cloudflare AI Gateway",
    provider: "anthropic",
    /** AI Gateway's catalog id (its spelling, not Anthropic's). */
    model: "anthropic/claude-opus-5.5",
  },
  {
    id: "llama-3.3-70b",
    label: "Llama 3.3 70B",
    via: "Workers AI",
    provider: "workers-ai",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },
] as const;
export type AgentModelId = (typeof AGENT_MODELS)[number]["id"];
export const AGENT_MODEL_IDS = AGENT_MODELS.map((m) => m.id) as [
  AgentModelId,
  ...AgentModelId[],
];
export const DEFAULT_AGENT_MODEL: AgentModelId = "claude-opus-5.5";
export const agentModel = (id: string | null | undefined) =>
  AGENT_MODELS.find((m) => m.id === id) ??
  AGENT_MODELS.find((m) => m.id === DEFAULT_AGENT_MODEL)!;
