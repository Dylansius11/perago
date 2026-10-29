import { describe, expect, it } from "vitest";
import { RENEW_WINDOW_SECONDS, renewState } from "./renew";

describe("renewState", () => {
  it("offers a renewal once the session has ended", () => {
    expect(renewState(0)).toBe("ended");
    expect(renewState(-1)).toBe("ended");
    expect(renewState(-86_400)).toBe("ended");
  });

  it("offers one while under two hours remain", () => {
    expect(renewState(1)).toBe("ending");
    expect(renewState(RENEW_WINDOW_SECONDS - 1)).toBe("ending");
  });

  it("stays quiet at two hours and above", () => {
    expect(RENEW_WINDOW_SECONDS).toBe(7_200);
    expect(renewState(RENEW_WINDOW_SECONDS)).toBeNull();
    expect(renewState(86_400)).toBeNull();
  });

  it("stays quiet when the policy carries no end time", () => {
    expect(renewState(null)).toBeNull();
  });
});
