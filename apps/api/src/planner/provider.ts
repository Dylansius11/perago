import Groq from "groq-sdk";

import type { PlannerPrompt } from "./prompt.js";

/**
 * The whole planner surface: one call that returns untrusted JSON. Transport
 * failure throws `PlannerUnavailableError`; any response, including a
 * malformed one, is returned for strict parsing by the compiler.
 */
export type Planner = (prompt: PlannerPrompt) => Promise<unknown>;

export class PlannerUnavailableError extends Error {}

export type GroqPlannerConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export function createGroqPlanner(config: GroqPlannerConfig): Planner {
  if (config.apiKey.length === 0) {
    throw new RangeError("a Groq API key is required for the planner");
  }
  const client = new Groq({
    apiKey: config.apiKey,
    maxRetries: 1,
    timeout: config.timeoutMs,
  });

  return async (prompt) => {
    let completion: Groq.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: config.model,
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
        include_reasoning: false,
        max_completion_tokens: 4_096,
        reasoning_effort: "medium",
        temperature: 0,
      });
    } catch (error) {
      // Provider errors can echo request details; keep only the status class.
      const status = error instanceof Groq.APIError ? error.status : undefined;
      throw new PlannerUnavailableError(
        `planner request failed${status === undefined ? "" : ` with HTTP ${status}`}`,
      );
    }

    const choice = completion.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content) {
      return null;
    }
    try {
      return JSON.parse(choice.message.content) as unknown;
    } catch {
      return null;
    }
  };
}
