import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenRouterPlanner,
  PlannerUnavailableError,
} from "./provider.js";

const prompt = {
  schema: {
    type: "object",
    properties: { action: { type: "object" } },
    required: ["action"],
    additionalProperties: false,
  },
  system: "Only one bounded action",
  user: "Swap 0.01 WBNB for Cake",
};
const candidate = {
  action: {
    kind: "SWAP",
    adapterId: "pancakeswap-v3",
    inputSymbol: "WBNB",
    inputAmount: "0.01",
    outputSymbol: "Cake",
    maxSlippageBps: null,
    recipient: null,
  },
};
const response = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const completion = (content: string | null, finish_reason = "stop") =>
  response(200, {
    choices: [{ finish_reason, message: { role: "assistant", content } }],
  });

const planner = () =>
  createOpenRouterPlanner({ apiKey: "test-key", timeoutMs: 5_000 });

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter planner boundary", () => {
  it("requests the bounded schema and parses a well-formed candidate", async () => {
    const requests: Array<{ url: string; body: unknown; auth: string | null }> =
      [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init.body)) as unknown,
        auth: new Headers(init.headers).get("authorization"),
      });
      return completion(JSON.stringify(candidate));
    });
    expect(await planner()(prompt)).toEqual(candidate);
    expect(requests).toEqual([
      {
        url: "https://openrouter.ai/api/v1/chat/completions",
        auth: "Bearer test-key",
        body: {
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
        },
      },
    ]);
  });

  it("does not send a second request or expose provider error payloads", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response(403, { error: { message: "secret key and user goal" } }),
      );
    vi.stubGlobal("fetch", fetch);
    const failure = await planner()(prompt).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PlannerUnavailableError);
    expect((failure as Error).message).toContain("HTTP 403");
    expect((failure as Error).message).not.toContain(
      "secret key and user goal",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed on non-JSON and truncated completions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(completion("not json"))
      .mockResolvedValueOnce(completion(JSON.stringify(candidate), "length"));
    vi.stubGlobal("fetch", fetch);
    expect(await planner()(prompt)).toBeNull();
    expect(await planner()(prompt)).toBeNull();
  });
});
