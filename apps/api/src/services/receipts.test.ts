import type { ExecutionReceipt } from "@perago/sdk";
import { describe, expect, it } from "vitest";

import { assertReceiptCommitments } from "./receipts.js";

const zero = `0x${"0".repeat(64)}` as const;
const successHash = `0x${"1".repeat(64)}` as const;
const failureHash = `0x${"2".repeat(64)}` as const;

describe("public receipt trust boundary", () => {
  it("refuses a stored success whose verification hash is not the finalized contract commitment", () => {
    const receipt: Pick<ExecutionReceipt, "status" | "verification"> = {
      status: "SUCCEEDED",
      verification: {
        status: "PASSED",
        hash: successHash,
        failureReasonHash: zero,
        reasonCode: "ONCHAIN_SUCCEEDED",
      },
    };
    const finalized = {
      recordStatus: "SUCCEEDED" as const,
      verificationHash: failureHash,
      failureReasonHash: zero,
    };
    expect(() => assertReceiptCommitments(receipt, finalized)).toThrow(
      "public receipt commitment disagrees with finalized MandateExecutor",
    );
    expect(() =>
      assertReceiptCommitments(receipt, {
        ...finalized,
        verificationHash: successHash,
      }),
    ).not.toThrow();
  });

  it("refuses a stored failure whose reason commitment differs from finalized contract storage", () => {
    const receipt: Pick<ExecutionReceipt, "status" | "verification"> = {
      status: "FAILED",
      verification: {
        status: "NOT_VERIFIED",
        hash: zero,
        failureReasonHash: failureHash,
        reasonCode: "ONCHAIN_FAILED",
      },
    };
    expect(() =>
      assertReceiptCommitments(receipt, {
        recordStatus: "FAILED",
        verificationHash: zero,
        failureReasonHash: successHash,
      }),
    ).toThrow(
      "public receipt commitment disagrees with finalized MandateExecutor",
    );
  });
});
