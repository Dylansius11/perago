import { encodeOwnerWithdrawal, withdrawalCalls } from "@perago/sdk";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import {
  type Asset,
  everythingForm,
  fundsHref,
  gasLine,
  maxText,
  parseFundsIntent,
  planWithdrawal,
  settledGas,
  withdrawAssets,
  withdrawsEverything,
} from "./model";

const owner = "0x1111111111111111111111111111111111111111" as const;
const wbnbAddress = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as const;
const cakeAddress = "0xfa60d973f7642b748046464e165a65b7323b0dee" as const;

const tokens = [
  { symbol: "WBNB", address: wbnbAddress, decimals: 18 },
  { symbol: "CAKE", address: cakeAddress, decimals: 18 },
];

function holdings(input: { native?: bigint; wbnb?: bigint; cake?: bigint }) {
  return {
    deployed: true,
    ownerNative: parseEther("1"),
    accountNative: input.native ?? 0n,
    tokens: {
      WBNB: {
        address: wbnbAddress,
        decimals: 18,
        balance: input.wbnb ?? 0n,
        allowance: 0n,
      },
      CAKE: {
        address: cakeAddress,
        decimals: 18,
        balance: input.cake ?? 0n,
        allowance: 0n,
      },
    },
  };
}

const assetsOf = (input: Parameters<typeof holdings>[0]): Asset[] =>
  withdrawAssets({ tokens, holdings: holdings(input) });

describe("withdrawAssets", () => {
  it("lists tBNB first, then every catalog token the account holds", () => {
    const assets = assetsOf({
      native: parseEther("0.5"),
      wbnb: parseEther("2"),
      cake: 5n,
    });
    expect(assets.map((asset) => asset.symbol)).toEqual([
      "tBNB",
      "WBNB",
      "CAKE",
    ]);
    expect(assets[0]).toMatchObject({ kind: "NATIVE", address: null });
    expect(assets[1]).toMatchObject({ kind: "TOKEN", wrapsNative: true });
    expect(assets[2]).toMatchObject({ kind: "TOKEN", wrapsNative: false });
  });

  it("leaves out anything the account does not hold", () => {
    expect(
      assetsOf({ native: 0n, wbnb: parseEther("1") }).map(
        (asset) => asset.symbol,
      ),
    ).toEqual(["WBNB"]);
    expect(assetsOf({})).toEqual([]);
  });

  it("shows the chain's mixed-case symbol in capitals but keys by the catalog's", () => {
    const rows = withdrawAssets({
      tokens: [{ symbol: "Cake", address: cakeAddress, decimals: 18 }],
      holdings: {
        ...holdings({}),
        tokens: {
          Cake: {
            address: cakeAddress,
            decimals: 18,
            balance: 1n,
            allowance: 0n,
          },
        },
      },
    });
    expect(rows).toEqual([
      expect.objectContaining({ id: "Cake", symbol: "CAKE" }),
    ]);
  });
});

describe("planWithdrawal", () => {
  const assets = assetsOf({
    native: parseEther("0.5"),
    wbnb: parseEther("2"),
    cake: parseEther("10"),
  });

  it("builds one token leg and one native leg from typed amounts", () => {
    const plan = planWithdrawal(assets, {
      amounts: { tBNB: "0.25", WBNB: "1.5" },
      unwrap: false,
    });
    expect(plan.errors).toEqual({});
    expect(plan.ready).toBe(true);
    expect(plan.entries.map((entry) => entry.leg)).toEqual([
      { kind: "NATIVE", amount: parseEther("0.25") },
      { kind: "TOKEN", token: wbnbAddress, amount: parseEther("1.5") },
    ]);
  });

  it("turns the WBNB leg into an unwrap when asked", () => {
    const plan = planWithdrawal(assets, {
      amounts: { WBNB: "1" },
      unwrap: true,
    });
    expect(plan.entries.map((entry) => entry.leg)).toEqual([
      { kind: "UNWRAP", wbnb: wbnbAddress, amount: parseEther("1") },
    ]);
    expect(plan.entries[0]).toMatchObject({
      leaves: "1 WBNB",
      arrives: "1 tBNB",
    });
  });

  it("never lets the unwrap toggle touch another token", () => {
    const plan = planWithdrawal(assets, {
      amounts: { CAKE: "3" },
      unwrap: true,
    });
    expect(plan.entries.map((entry) => entry.leg)).toEqual([
      { kind: "TOKEN", token: cakeAddress, amount: parseEther("3") },
    ]);
    expect(plan.entries[0]).toMatchObject({
      leaves: "3 CAKE",
      arrives: "3 CAKE",
    });
  });

  it("skips blank rows and is not ready with nothing entered", () => {
    const plan = planWithdrawal(assets, {
      amounts: { tBNB: "", WBNB: "  " },
      unwrap: false,
    });
    expect(plan.entries).toEqual([]);
    expect(plan.errors).toEqual({});
    expect(plan.ready).toBe(false);
  });

  it("reports errors in token units and is not ready", () => {
    const plan = planWithdrawal(assets, {
      amounts: {
        tBNB: "0",
        WBNB: "2.000000000000000001",
        CAKE: "10.5",
      },
      unwrap: false,
    });
    expect(plan.errors.tBNB).toBe("Must be more than zero.");
    expect(plan.errors.WBNB).toBe("The account holds 2 WBNB. Enter 2 or less.");
    expect(plan.errors.CAKE).toBe(
      "The account holds 10 CAKE. Enter 10 or less.",
    );
    expect(plan.ready).toBe(false);
  });

  it("respects decimals and rejects malformed text", () => {
    const usdc = withdrawAssets({
      tokens: [
        ...tokens,
        {
          symbol: "USDC",
          address: wbnbAddress.replace("ae", "af") as never,
          decimals: 6,
        },
      ],
      holdings: {
        ...holdings({}),
        tokens: {
          ...holdings({}).tokens,
          USDC: {
            address: wbnbAddress.replace("ae", "af") as never,
            decimals: 6,
            balance: 5_000_000n,
            allowance: 0n,
          },
        },
      },
    });
    const plan = planWithdrawal(usdc, {
      amounts: { USDC: "1.1234567" },
      unwrap: false,
    });
    expect(plan.errors.USDC).toBe("At most 6 decimal places.");
    expect(
      planWithdrawal(usdc, { amounts: { USDC: "1e3" }, unwrap: false }).errors
        .USDC,
    ).toBe("Use digits and one decimal point only.");
    expect(
      planWithdrawal(usdc, { amounts: { USDC: "1.5" }, unwrap: false })
        .entries[0]?.leg,
    ).toMatchObject({ amount: 1_500_000n });
  });

  it("MAX is the exact balance and survives the round trip", () => {
    const wbnb = assets.find((asset) => asset.symbol === "WBNB") as Asset;
    expect(maxText(wbnb)).toBe("2");
    const odd = assetsOf({ wbnb: 123_456_789_012_345_678n });
    expect(maxText(odd[0] as Asset)).toBe("0.123456789012345678");
    const plan = planWithdrawal(odd, {
      amounts: { WBNB: maxText(odd[0] as Asset) },
      unwrap: false,
    });
    expect(plan.entries[0]?.leg).toEqual({
      kind: "TOKEN",
      token: wbnbAddress,
      amount: 123_456_789_012_345_678n,
    });
  });

  it("produces calldata the SDK encodes in the contract order", () => {
    const plan = planWithdrawal(assets, {
      amounts: { tBNB: "0.5", WBNB: "2", CAKE: "10" },
      unwrap: true,
    });
    const legs = plan.entries.map((entry) => entry.leg);
    const calls = withdrawalCalls({ owner, legs });
    expect(calls.map((call) => call.target)).toEqual([
      wbnbAddress,
      owner,
      cakeAddress,
      owner,
    ]);
    expect(() => encodeOwnerWithdrawal({ owner, legs })).not.toThrow();
  });
});

describe("everythingForm", () => {
  it("fills every holding with its exact balance", () => {
    const assets = assetsOf({
      native: parseEther("0.5"),
      wbnb: parseEther("2"),
      cake: 7n,
    });
    const form = everythingForm(assets, false);
    expect(form.amounts).toEqual({
      tBNB: "0.5",
      WBNB: "2",
      CAKE: "0.000000000000000007",
    });
    const plan = planWithdrawal(assets, form);
    expect(plan.errors).toEqual({});
    expect(plan.entries.map((entry) => entry.leg.kind)).toEqual([
      "NATIVE",
      "TOKEN",
      "TOKEN",
    ]);
  });

  it("carries the unwrap choice and skips an empty account", () => {
    const assets = assetsOf({ wbnb: parseEther("1") });
    expect(everythingForm(assets, true).unwrap).toBe(true);
    expect(everythingForm([], false)).toEqual({ amounts: {}, unwrap: false });
  });
});

describe("gasLine", () => {
  const floor = parseEther("0.002");

  it("says Sponsored by Perago on the sponsored path", () => {
    const line = gasLine({
      sponsored: true,
      ownerNative: parseEther("1"),
      floor,
    });
    expect(line.headline).toBe("Sponsored by Perago");
    expect(line.warning).toBeNull();
  });

  it("says Paid from your wallet on the owner-paid path", () => {
    const line = gasLine({
      sponsored: false,
      ownerNative: parseEther("1"),
      floor,
    });
    expect(line.headline).toBe("Paid from your wallet");
    expect(line.warning).toBeNull();
  });

  it("warns before signing when the owner path is needed and the wallet is short", () => {
    const line = gasLine({
      sponsored: false,
      ownerNative: parseEther("0.001"),
      floor,
    });
    expect(line.headline).toBe("Paid from your wallet");
    expect(line.warning).toBe(
      "Your wallet holds 0.001 tBNB. Paying this fee needs about 0.002 tBNB.",
    );
  });

  it("warns about the fallback too when sponsorship may be refused", () => {
    const line = gasLine({
      sponsored: true,
      ownerNative: parseEther("0.001"),
      floor,
    });
    expect(line.headline).toBe("Sponsored by Perago");
    expect(line.warning).toBe(
      "If sponsorship is refused your wallet pays, and it holds 0.001 tBNB. That needs about 0.002 tBNB.",
    );
  });

  it("does not warn while the wallet balance is still unread", () => {
    expect(
      gasLine({ sponsored: false, ownerNative: null, floor }).warning,
    ).toBeNull();
  });

  it("names the path that actually ran", () => {
    expect(settledGas(true)).toBe("Sponsored by Perago");
    expect(settledGas(false)).toBe("Paid from your wallet");
  });
});

describe("funds links", () => {
  it("round-trips a prefilled withdrawal", () => {
    const href = fundsHref({ symbol: "WBNB", amount: "0.25" });
    expect(href).toBe("/app?funds=withdraw&asset=WBNB&amount=0.25#funds");
    const search = href.slice(href.indexOf("?"), href.indexOf("#"));
    expect(parseFundsIntent(search, ["tBNB", "WBNB", "CAKE"])).toEqual({
      direction: "withdraw",
      symbol: "WBNB",
      amount: "0.25",
    });
  });

  it("opens the withdraw direction with nothing prefilled", () => {
    expect(fundsHref({ symbol: null, amount: null })).toBe(
      "/app?funds=withdraw#funds",
    );
    expect(parseFundsIntent("?funds=withdraw", ["tBNB", "WBNB"])).toEqual({
      direction: "withdraw",
      symbol: null,
      amount: null,
    });
  });

  it("ignores unknown assets, junk amounts, and other directions", () => {
    expect(
      parseFundsIntent("?funds=withdraw&asset=EVIL&amount=1e9", ["WBNB"]),
    ).toEqual({ direction: "withdraw", symbol: null, amount: null });
    expect(parseFundsIntent("?funds=send", ["WBNB"])).toBeNull();
    expect(parseFundsIntent("", ["WBNB"])).toBeNull();
    expect(
      parseFundsIntent("?funds=withdraw&asset=wbnb", ["WBNB"])?.symbol,
    ).toBe("WBNB");
  });
});

describe("withdrawsEverything", () => {
  const assets = assetsOf({ native: parseEther("1"), wbnb: parseEther("2") });

  it("is true only when every holding leaves in full", () => {
    expect(
      withdrawsEverything(
        assets,
        planWithdrawal(assets, everythingForm(assets, false)),
      ),
    ).toBe(true);
    expect(
      withdrawsEverything(
        assets,
        planWithdrawal(assets, {
          amounts: { tBNB: "1", WBNB: "1" },
          unwrap: false,
        }),
      ),
    ).toBe(false);
    expect(
      withdrawsEverything(
        assets,
        planWithdrawal(assets, { amounts: { tBNB: "1" }, unwrap: false }),
      ),
    ).toBe(false);
    expect(
      withdrawsEverything([], planWithdrawal([], everythingForm([], false))),
    ).toBe(false);
  });
});
