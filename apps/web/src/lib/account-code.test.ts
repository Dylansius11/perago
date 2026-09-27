import { describe, expect, it } from "vitest";
import { assertPinnedAccountCode } from "./account-code";

const owner = "0x808e215626f00f3c64082341a97bca470cb71fac" as const;
const code =
  "0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3808e215626f00f3c64082341a97bca470cb71fac" as const;
const implementation =
  "0x000000000000000000000000000000000000c5a9089039570dd36455b5c07383" as const;

describe("owner-bound smart account code", () => {
  it("accepts the chain-97 fork runtime and pinned ERC-1967 implementation", () => {
    expect(() =>
      assertPinnedAccountCode({ owner, code, implementation }),
    ).not.toThrow();
  });

  it("refuses a different owner in the proxy and a swapped implementation", () => {
    expect(() =>
      assertPinnedAccountCode({
        owner: "0x1111111111111111111111111111111111111111",
        code,
        implementation,
      }),
    ).toThrow();
    expect(() =>
      assertPinnedAccountCode({
        owner,
        code,
        implementation:
          "0x0000000000000000000000001111111111111111111111111111111111111111",
      }),
    ).toThrow();
  });
});
