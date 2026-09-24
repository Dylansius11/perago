import { describe, expect, it } from "vitest";

import { minimumAfterSlippage } from "./swap.js";

describe("minimumAfterSlippage", () => {
  it("rounds down so the minimum never exceeds the slippage bound", () => {
    // 999 * 9_900 / 10_000 = 989.01: a minimum of 990 would bound 0.9% slippage.
    expect(minimumAfterSlippage(999n, "100")).toBe(989n);
  });

  it("keeps the whole estimate at zero slippage", () => {
    expect(minimumAfterSlippage(12_345n, "0")).toBe(12_345n);
  });

  it("derives zero for a dust estimate, which simulation then refuses", () => {
    expect(minimumAfterSlippage(1n, "1")).toBe(0n);
  });

  it("refuses a bound wider than the whole estimate", () => {
    expect(() => minimumAfterSlippage(100n, "10001")).toThrow(RangeError);
  });
});
