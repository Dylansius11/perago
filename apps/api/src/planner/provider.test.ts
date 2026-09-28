import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiPlanner, PlannerUnavailableError } from "./provider.js";

const prompt = {
  schema: {
    type: "object",
    properties: { action: { type: "object" } },
    required: ["action"],
    additionalProperties: false,
  },
  system: "Only one bounded action",
  user: "Swap 0.01 WBNB for CAKE",
};
const candidate = { action: { kind: "CLARIFY", question: "Which token?" } };
const response = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const success = () =>
  response(200, {
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(candidate) }] },
      },
    ],
  });

const planner = () =>
  createGeminiPlanner({ apiKey: "test-key", timeoutMs: 5_000 });

afterEach(() => vi.unstubAllGlobals());

describe("Gemini planner", () => {
  it("sends the closed schema to the primary model and returns untrusted JSON", async () => {
    const requests: Array<{ url: string; body: unknown; key: string | null }> =
      [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)) as unknown,
        key: new Headers(init.headers).get("x-goog-api-key"),
      });
      return success();
    });
    expect(await planner()(prompt)).toEqual(candidate);
    expect(requests).toEqual([
      {
        url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        key: "test-key",
        body: {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: prompt.schema,
            maxOutputTokens: 2048,
            temperature: 0,
            thinkingConfig: { thinkingLevel: "LOW" },
          },
        },
      },
    ]);
  });

  it("uses 3.7 Flash at most once on primary rate exhaustion", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      models.push(url);
      return models.length === 1
        ? response(429, { error: "quota" })
        : success();
    });
    expect(await planner()(prompt)).toEqual(candidate);
    expect(models.map((url) => url.split("/models/")[1])).toEqual([
      "gemini-3.8-flash:generateContent",
      "gemini-3.7-flash:generateContent",
    ]);
  });

  it("does not amplify an exhausted project quota or leak provider errors", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      models.push(url);
      return response(429, { error: "sensitive provider payload" });
    });
    const error = await planner()(prompt).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PlannerUnavailableError);
    expect((error as Error).message).not.toContain(
      "sensitive provider payload",
    );
    expect(models).toHaveLength(2);
  });

  it("does not retry authentication failure or malformed successful output", async () => {
    const fetch = vi.fn().mockResolvedValue(response(403, { error: "secret" }));
    vi.stubGlobal("fetch", fetch);
    await expect(planner()(prompt)).rejects.toThrow(PlannerUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockResolvedValue(
      response(200, { candidates: [{ finishReason: "MAX_TOKENS" }] }),
    );
    expect(await planner()(prompt)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
