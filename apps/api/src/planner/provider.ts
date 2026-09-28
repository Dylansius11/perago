import type { PlannerPrompt } from "./prompt.js";

/** Returns untrusted JSON for deterministic validation; transport failures are retryable. */
export type Planner = (prompt: PlannerPrompt) => Promise<unknown>;

export class PlannerUnavailableError extends Error {}

export type GeminiPlannerConfig = {
  apiKey: string;
  timeoutMs: number;
};

const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"] as const;

/** One primary request and, only for a transient failure, one fallback request. */
export function createGeminiPlanner(config: GeminiPlannerConfig): Planner {
  if (!config.apiKey.trim()) {
    throw new RangeError("a Gemini API key is required for the planner");
  }

  return async (prompt) => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: prompt.schema,
        maxOutputTokens: 2048,
        temperature: 0,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });

    for (const [index, model] of MODELS.entries()) {
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            body,
            signal: AbortSignal.timeout(config.timeoutMs),
          },
        );
      } catch {
        if (index === 0) continue;
        throw new PlannerUnavailableError("planner request failed");
      }

      if (!response.ok) {
        if (
          index === 0 &&
          (response.status === 429 ||
            response.status >= 500 ||
            response.status === 404)
        ) {
          continue;
        }
        // Never log or propagate provider payloads: they can contain the key or goal.
        throw new PlannerUnavailableError(
          `planner request failed with HTTP ${response.status}`,
        );
      }

      let completion: unknown;
      try {
        completion = await response.json();
      } catch {
        return null;
      }
      if (
        typeof completion !== "object" ||
        completion === null ||
        !("candidates" in completion)
      )
        return null;
      const candidates = completion.candidates;
      if (!Array.isArray(candidates)) return null;
      const candidate: unknown = candidates[0];
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        !("finishReason" in candidate) ||
        candidate.finishReason !== "STOP" ||
        !("content" in candidate)
      )
        return null;
      const content: unknown = candidate.content;
      if (
        typeof content !== "object" ||
        content === null ||
        !("parts" in content) ||
        !Array.isArray(content.parts)
      )
        return null;
      const part: unknown = content.parts[0];
      if (
        typeof part !== "object" ||
        part === null ||
        !("text" in part) ||
        typeof part.text !== "string"
      )
        return null;
      try {
        return JSON.parse(part.text) as unknown;
      } catch {
        return null;
      }
    }
    throw new PlannerUnavailableError("planner request failed");
  };
}
