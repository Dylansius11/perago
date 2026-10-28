import { type ExecutionReceipt, executionReceiptSchema } from "@perago/sdk";
import { describe, expect, it } from "vitest";
import {
  addressUrl,
  deriveReceiptVerdict,
  mandateRecordUrl,
  proofRows,
  settlementCopy,
  txUrl,
  verificationCopy,
} from "./model";

const h = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`;
const executor = "0x5587896753ad6f65ad40ee812f4e1160f6691b7c";

function receipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return executionReceiptSchema.parse({
    schemaVersion: "1",
    status: "SUCCEEDED",
    chainId: "97",
    account: "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944",
    mandateExecutor: executor,
    mandateHash: h("1"),
    policyHash: h("2"),
    intentHash: h("3"),
    planHash: h("4"),
    simulationHash: h("5"),
    actionHash: h("6"),
    postconditionHash: h("7"),
    nonce: "1",
    authorityConsumed: true,
    terminalReasonCode: "MANDATE_SUCCEEDED",
    terminalMessage: "The mandate succeeded.",
    transactions: {
      authorize: h("a"),
      begin: h("b"),
      userOperation: h("c"),
      execution: h("d"),
    },
    authorization: { blockNumber: "100", blockHash: h("e") },
    begin: { blockNumber: "102", blockHash: h("f") },
    terminal: {
      transactionHash: h("d"),
      blockNumber: "104",
      blockHash: h("9"),
      logIndex: 3,
    },
    explorer: {
      authorization: `https://testnet.bscscan.com/tx/${h("a")}`,
      begin: `https://testnet.bscscan.com/tx/${h("b")}`,
      execution: `https://testnet.bscscan.com/tx/${h("d")}`,
      terminal: `https://testnet.bscscan.com/tx/${h("d")}`,
      block: "https://testnet.bscscan.com/block/104",
    },
    verification: {
      status: "PASSED",
      hash: h("8"),
      failureReasonHash: null,
      reasonCode: "VERIFIED",
    },
    settlement: { status: "NOT_BOUND" },
    ...overrides,
  });
}

describe("BscScan links", () => {
  it("builds transaction, address, and read-function links on the chain-97 explorer", () => {
    expect(txUrl(h("a"))).toBe(`https://testnet.bscscan.com/tx/${h("a")}`);
    expect(addressUrl(executor)).toBe(
      `https://testnet.bscscan.com/address/${executor}`,
    );
    expect(mandateRecordUrl(executor)).toBe(
      `https://testnet.bscscan.com/address/${executor}#readContract`,
    );
  });
});

describe("deriveReceiptVerdict", () => {
  it("calls a succeeded and verified receipt verified, with no reason block", () => {
    const verdict = deriveReceiptVerdict(receipt());
    expect(verdict.kind).toBe("verified");
    expect(verdict.tone).toBe("ok");
    expect(verdict.headline).toBe("Verified onchain. Authority ended.");
    expect(verdict.reason).toBeNull();
  });

  it("never draws success without a passed verification as verified", () => {
    const verdict = deriveReceiptVerdict(
      receipt({
        verification: {
          status: "NOT_VERIFIED",
          hash: null,
          failureReasonHash: null,
          reasonCode: "NOT_VERIFIED",
        },
      }),
    );
    expect(verdict.kind).toBe("unverified");
    expect(verdict.tone).not.toBe("ok");
    expect(verdict.headline).not.toMatch(/^Verified/u);
    expect(verdict.detail).toContain("not verified");
  });

  it("keeps the stable reason code and the API sentence on a failure", () => {
    const verdict = deriveReceiptVerdict(
      receipt({
        status: "FAILED",
        terminalReasonCode: "OUTPUT_BELOW_MINIMUM",
        terminalMessage: "The swap returned less than the signed minimum.",
      }),
    );
    expect(verdict.kind).toBe("failed");
    expect(verdict.tone).toBe("fail");
    expect(verdict.reason).toEqual({
      code: "OUTPUT_BELOW_MINIMUM",
      message: "The swap returned less than the signed minimum.",
    });
    expect(verdict.detail).toContain("cannot run again");
  });

  it("says nothing ran when a mandate was revoked or expired without an execution", () => {
    const revoked = deriveReceiptVerdict(
      receipt({
        status: "REVOKED",
        transactions: {
          authorize: h("a"),
          begin: null,
          userOperation: null,
          execution: null,
        },
        begin: null,
      }),
    );
    expect(revoked.kind).toBe("revoked");
    expect(revoked.detail).toContain("Nothing was executed");
    const expired = deriveReceiptVerdict(
      receipt({
        status: "EXPIRED",
        transactions: {
          authorize: h("a"),
          begin: null,
          userOperation: null,
          execution: null,
        },
        begin: null,
      }),
    );
    expect(expired.kind).toBe("expired");
    expect(expired.headline).toBe("Expired before it ran.");
    expect(expired.detail).toContain("nothing was executed");
  });
});

describe("proofRows", () => {
  it("lists authorize, begin, and execute with their links, folding the final event into execute", () => {
    const rows = proofRows(receipt());
    expect(rows.map((row) => row.key)).toEqual([
      "authorize",
      "begin",
      "execute",
    ]);
    expect(rows[0]).toMatchObject({
      hash: h("a"),
      href: txUrl(h("a")),
      block: "100",
    });
    expect(rows[1]?.block).toBe("102");
    expect(rows[2]).toMatchObject({
      hash: h("d"),
      block: "104",
      note: "Final event, log 3",
    });
  });

  it("adds a terminal row when the final event came from another transaction", () => {
    const rows = proofRows(
      receipt({
        status: "REVOKED",
        transactions: {
          authorize: h("a"),
          begin: null,
          userOperation: null,
          execution: null,
        },
        begin: null,
        terminal: {
          transactionHash: h("9"),
          blockNumber: "110",
          blockHash: h("8"),
          logIndex: 0,
        },
      }),
    );
    expect(rows.map((row) => row.key)).toEqual([
      "authorize",
      "begin",
      "execute",
      "terminal",
    ]);
    expect(rows[1]).toMatchObject({ hash: null, href: null, block: null });
    expect(rows[3]).toMatchObject({
      label: "Revocation",
      href: txUrl(h("9")),
      block: "110",
    });
  });
});

describe("verification and settlement copy", () => {
  it("states an unbound settlement as no payment, never as a payout", () => {
    expect(settlementCopy({ status: "NOT_BOUND" })).toBe(
      "No agent payment is attached to this task.",
    );
  });

  it("describes a payout as made only when it is confirmed", () => {
    const bound = { commerceContract: executor, jobId: "1" } as const;
    for (const status of ["PENDING", "INELIGIBLE", "UNPAID"] as const) {
      expect(settlementCopy({ status, ...bound })).not.toMatch(/confirmed/u);
    }
    expect(verificationCopy("PASSED")).toMatch(/^Passed/u);
    expect(verificationCopy("NOT_VERIFIED")).toMatch(/^Not verified/u);
    expect(verificationCopy("NOT_APPLICABLE")).toMatch(/^Not applicable/u);
  });
});
