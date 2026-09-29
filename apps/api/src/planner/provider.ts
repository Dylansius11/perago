import type { PlannerPrompt } from "./prompt.js";

/** Returns untrusted JSON for deterministic validation; transport failures are retryable. */
export type Planner = (prompt: PlannerPrompt) => Promise<unknown>;

export class PlannerUnavailableError extends Error {}

export type OpenRouterPlannerConfig = {
  apiKey: string;
  timeoutMs: number;
};

/** One bounded request; malformed output remains untrusted and fails closed in the compiler. */
export function createOpenRouterPlanner(
  config: OpenRouterPlannerConfig,
): Planner {
  if (!config.apiKey.trim()) {
    throw new RangeError("an OpenRouter API key is required for the planner");
  }

  return async (prompt) => {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "stealth/space-bunny-alpha",
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "perago_plan_candidate",
              strict: true,
              schema: prompt.schema,
            },
          },
          reasoning: { effort: "low" },
          max_tokens: 2048,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new PlannerUnavailableError("planner request failed");
    }

    // Provider payloads can contain the key or goal; never read them on error.
    if (!response.ok) {
      throw new PlannerUnavailableError(
        `planner request failed with HTTP ${response.status}`,
      );
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return null;
    }
    if (typeof result !== "object" || result === null || !("choices" in result))
      return null;
    const choices = result.choices;
    if (!Array.isArray(choices)) return null;
    const choice: unknown = choices[0];
    if (
      typeof choice !== "object" ||
      choice === null ||
      !("finish_reason" in choice) ||
      choice.finish_reason !== "stop" ||
      !("message" in choice)
    )
      return null;
    const message: unknown = choice.message;
    if (
      typeof message !== "object" ||
      message === null ||
      !("content" in message) ||
      typeof message.content !== "string"
    )
      return null;
    try {
      return JSON.parse(message.content) as unknown;
    } catch {
      return null;
    }
  };
}
