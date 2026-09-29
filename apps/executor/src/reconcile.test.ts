import {
  type ExecutionJob,
  executionJobSchema,
  getTaskMandateTypedData,
} from "@perago/sdk";
import { hashTypedData, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import type { ExecutorDeployment } from "./config.ts";
import { assertDrivableJob, type ChainView, decide } from "./reconcile.ts";

const executor = "0x3333333333333333333333333333333333333333" as const;
const mandateExecutor = "0x9999999999999999999999999999999999999999" as const;
const action = "0xc0ffee" as const;
const hash = `0x${"aa".repeat(32)}` as const;
const WINDOW = 600n;
const EXPIRES_AT = 2_000_000_000n;
const MAX_INPUT = 1_000n;
const STARTED_AT = EXPIRES_AT - 1_000n;

const message = {
  account: "0x1111111111111111111111111111111111111111",
  rootOwner: "0x2222222222222222222222222222222222222222",
  ownerEpoch: "1",
  executor,
  chainId: "97",
  nonce: "7",
  expiresAt: EXPIRES_AT.toString(),
  policyHash: hash,
  intentHash: hash,
  planHash: hash,
  simulationHash: hash,
  adapter: "0x4444444444444444444444444444444444444444",
  adapterSelector: "0x12345678",
  inputToken: "0x5555555555555555555555555555555555555555",
  maxInput: MAX_INPUT.toString(),
  outputToken: "0x6666666666666666666666666666666666666666",
  minOutput: "1",
  recipient: "0x1111111111111111111111111111111111111111",
  actionHash: keccak256(action),
  postconditionHash: hash,
  commerceContract: "0x0000000000000000000000000000000000000000",
  commerceJobId: "0",
};
const domain = { chainId: "97", verifyingContract: mandateExecutor };
const deployment: ExecutorDeployment = {
  chainId: 97,
  executionWindowSeconds: WINDOW,
  label: "test",
  mandateExecutor,
  mandateExecutorCodeHash: hash,
};

function jobWith(overrides: Record<string, unknown> = {}): ExecutionJob {
  const document = { primaryType: "TaskMandate", domain, message };
  return executionJobSchema.parse({
    executionId: "00000000-0000-4000-8000-000000000001",
    mandateHash: hashTypedData(getTaskMandateTypedData(message, domain)),
    status: "LEASED",
    mandateStatus: "SIGNED",
    document,
    rootSignature: `0x${"11".repeat(65)}`,
    action,
    session: { entityId: 1, signer: executor },
    pending: null,
    transactions: {
      authorize: null,
      begin: null,
      userOperation: null,
      perform: null,
      finalize: null,
    },
    lastError: null,
    leaseExpiresAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  });
}

function chainWith(overrides: Partial<ChainView> = {}): ChainView {
  return {
    timestamp: EXPIRES_AT - 100n,
    record: { status: "NONE", executionStartedAt: 0n },
    allowance: MAX_INPUT,
    balance: MAX_INPUT,
    executorNonce: 5n,
    executorGas: {
      balance: 10_000_000_000_000_000n,
      price: 1_000_000_000n,
    },
    commerce: null,
    pending: null,
    ...overrides,
  };
}

const pendingAuthorize = {
  kind: "AUTHORIZE",
  transactionHash: hash,
  rawTransaction: "0x02f8",
  userOperationHash: null,
};

describe("decide", () => {
  it.each(["TERMINAL", "REJECTED"])(
    "ends a %s job without reading further",
    (status) => {
      expect(decide(jobWith({ status }), chainWith(), WINDOW)).toEqual({
        kind: "DONE",
      });
    },
  );

  describe("an in-flight transaction is resolved before anything new is signed", () => {
    const job = jobWith({ pending: pendingAuthorize, status: "AUTHORIZING" });

    it("waits while it is included but not finalized", () => {
      expect(
        decide(
          job,
          chainWith({
            pending: { nonce: 5n, included: true, inMempool: false },
          }),
          WINDOW,
        ).kind,
      ).toBe("WAIT");
    });

    it("waits while it sits in the mempool", () => {
      expect(
        decide(
          job,
          chainWith({
            pending: { nonce: 5n, included: false, inMempool: true },
          }),
          WINDOW,
        ).kind,
      ).toBe("WAIT");
    });

    it("rebroadcasts the same bytes when it vanished and its nonce is still open", () => {
      expect(
        decide(
          job,
          chainWith({
            executorNonce: 5n,
            pending: { nonce: 5n, included: false, inMempool: false },
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "REBROADCAST" });
    });

    it("retires it when another transaction consumed its nonce", () => {
      expect(
        decide(
          job,
          chainWith({
            executorNonce: 6n,
            pending: { nonce: 5n, included: false, inMempool: false },
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "RETIRE" });
    });
  });

  it("never signs while latest is ahead of the finalized projection", () => {
    expect(
      decide(
        jobWith(),
        chainWith({ record: { status: "AUTHORIZED", executionStartedAt: 0n } }),
        WINDOW,
      ).kind,
    ).toBe("WAIT");
  });

  describe("before authorization", () => {
    it("authorizes only with the exact allowance and balance", () => {
      expect(decide(jobWith(), chainWith(), WINDOW)).toEqual({
        kind: "SUBMIT",
        transaction: "AUTHORIZE",
      });
    });

    it("defers without the exact root approval (D-004)", () => {
      expect(
        decide(jobWith(), chainWith({ allowance: MAX_INPUT - 1n }), WINDOW),
      ).toEqual({
        code: "APPROVAL_MISSING",
        kind: "DEFER",
      });
    });

    it("defers when the account cannot fund the signed input", () => {
      expect(
        decide(jobWith(), chainWith({ balance: MAX_INPUT - 1n }), WINDOW),
      ).toEqual({
        code: "INPUT_BALANCE_SHORT",
        kind: "DEFER",
      });
    });

    it("keeps a signed mandate unconsumed when executor gas cannot cover the operation", () => {
      expect(
        decide(
          jobWith(),
          chainWith({
            executorGas: {
              balance: 2_834_071_000_000_000n,
              price: 1_000_000_000n,
            },
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "DEFER", code: "EXECUTOR_GAS_SHORT" });
    });

    it("never authorizes at or after expiry", () => {
      expect(
        decide(jobWith(), chainWith({ timestamp: EXPIRES_AT }), WINDOW).kind,
      ).toBe("WAIT");
    });
  });

  describe("after authorization", () => {
    const job = jobWith({ mandateStatus: "AUTHORIZED", status: "AUTHORIZED" });
    const authorized = {
      status: "AUTHORIZED" as const,
      executionStartedAt: 0n,
    };

    it("begins the one attempt before expiry", () => {
      expect(
        decide(
          job,
          chainWith({ record: authorized, timestamp: EXPIRES_AT - 1n }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "BEGIN" });
    });

    it("finalizes expiry from the expiry second on", () => {
      expect(
        decide(
          job,
          chainWith({ record: authorized, timestamp: EXPIRES_AT }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "FINALIZE_EXPIRED" });
    });

    it("does not begin if the approval was withdrawn", () => {
      expect(
        decide(job, chainWith({ allowance: 0n, record: authorized }), WINDOW)
          .kind,
      ).toBe("DEFER");
    });
    it("does not begin when gas became insufficient after authorization", () => {
      expect(
        decide(
          job,
          chainWith({
            record: authorized,
            executorGas: {
              balance: 2_834_071_000_000_000n,
              price: 1_000_000_000n,
            },
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "DEFER", code: "EXECUTOR_GAS_SHORT" });
    });
  });

  describe("during the accepted attempt", () => {
    const job = jobWith({ mandateStatus: "EXECUTING", status: "EXECUTING" });
    const executing = {
      status: "EXECUTING" as const,
      executionStartedAt: STARTED_AT,
    };

    it("performs through the last second of the window", () => {
      expect(
        decide(
          job,
          chainWith({ record: executing, timestamp: STARTED_AT + WINDOW }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "PERFORM" });
    });

    it("finalizes a stalled attempt once the window has passed", () => {
      expect(
        decide(
          job,
          chainWith({ record: executing, timestamp: STARTED_AT + WINDOW + 1n }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "FINALIZE_STALLED" });
    });

    it("never submits a second UserOperation after one was included", () => {
      const included = jobWith({
        mandateStatus: "EXECUTING",
        status: "VERIFYING",
        transactions: {
          authorize: hash,
          begin: hash,
          userOperation: hash,
          perform: hash,
          finalize: null,
        },
      });
      expect(
        decide(
          included,
          chainWith({ record: executing, timestamp: STARTED_AT + 1n }),
          WINDOW,
        ).kind,
      ).toBe("WAIT");
    });

    it("waits out the window instead of performing an expired mandate", () => {
      const lateStart = {
        status: "EXECUTING" as const,
        executionStartedAt: EXPIRES_AT - 10n,
      };
      expect(
        decide(
          job,
          chainWith({ record: lateStart, timestamp: EXPIRES_AT }),
          WINDOW,
        ).kind,
      ).toBe("WAIT");
    });
  });
  describe("bound commerce outcome", () => {
    const bound = {
      ...message,
      commerceContract: mandateExecutor,
      commerceJobId: "4",
    };
    const signed = {
      document: { primaryType: "TaskMandate", domain, message: bound },
      mandateHash: hashTypedData(getTaskMandateTypedData(bound, domain)),
    };
    const submitted = {
      status: "Submitted" as const,
      valid: true,
      refundable: true,
      expiredAt: EXPIRES_AT + 2_000n,
    };

    it("requests payment only after finalized verified mandate success", () => {
      expect(
        decide(
          jobWith({
            ...signed,
            mandateStatus: "SUCCEEDED",
            status: "SETTLING",
          }),
          chainWith({
            record: { status: "SUCCEEDED", executionStartedAt: STARTED_AT },
            commerce: submitted,
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "SETTLE" });
      expect(
        decide(
          jobWith({
            ...signed,
            mandateStatus: "SUCCEEDED",
            status: "SETTLING",
          }),
          chainWith({
            record: { status: "AUTHORIZED", executionStartedAt: 0n },
            commerce: submitted,
          }),
          WINDOW,
        ).kind,
      ).toBe("WAIT");
    });

    it("routes terminal failure only to refund and never to payment", () => {
      expect(
        decide(
          jobWith({ ...signed, mandateStatus: "FAILED", status: "REFUNDING" }),
          chainWith({
            record: { status: "FAILED", executionStartedAt: STARTED_AT },
            commerce: submitted,
          }),
          WINDOW,
        ),
      ).toEqual({ kind: "SUBMIT", transaction: "REJECT_JOB" });
    });

    it("claims the exact expired escrow without ever reporting payment", () => {
      const expired = {
        ...submitted,
        valid: false,
        refundable: true,
        expiredAt: EXPIRES_AT - 1n,
      };
      for (const mandateStatus of ["SUCCEEDED", "FAILED"] as const) {
        const job = jobWith({
          ...signed,
          mandateStatus,
          status: mandateStatus === "SUCCEEDED" ? "SETTLING" : "REFUNDING",
        });
        const record = {
          status: mandateStatus,
          executionStartedAt: STARTED_AT,
        };
        expect(
          decide(
            job,
            chainWith({ record, timestamp: EXPIRES_AT, commerce: expired }),
            WINDOW,
          ),
        ).toEqual({ kind: "SUBMIT", transaction: "CLAIM_REFUND" });
        expect(
          decide(
            job,
            chainWith({
              record,
              timestamp: EXPIRES_AT,
              commerce: { ...expired, refundable: false },
            }),
            WINDOW,
          ).kind,
        ).toBe("WAIT");
        expect(
          decide(
            job,
            chainWith({
              record,
              commerce: { ...submitted, status: "Completed" },
            }),
            WINDOW,
          ).kind,
        ).toBe("WAIT");
      }
    });
  });
});

describe("assertDrivableJob", () => {
  it("accepts a job signed for this executor and deployment", () => {
    expect(() =>
      assertDrivableJob(jobWith(), deployment, executor),
    ).not.toThrow();
  });

  it.each([
    ["other action bytes", { action: "0xc0ffef" }],
    ["another mandate hash", { mandateHash: hash }],
    [
      "another session signer",
      { session: { entityId: 1, signer: mandateExecutor } },
    ],
  ])("refuses %s", (_name, overrides) => {
    expect(() =>
      assertDrivableJob(jobWith(overrides), deployment, executor),
    ).toThrow(/refusing job/u);
  });

  it("refuses a job for another executor key", () => {
    expect(() =>
      assertDrivableJob(jobWith(), deployment, mandateExecutor),
    ).toThrow(/another executor/u);
  });

  it("refuses a job on another MandateExecutor", () => {
    expect(() =>
      assertDrivableJob(
        jobWith(),
        { ...deployment, mandateExecutor: executor },
        executor,
      ),
    ).toThrow(/another MandateExecutor/u);
  });

  it("refuses a job when this worker runs on another chain", () => {
    expect(() =>
      assertDrivableJob(jobWith(), { ...deployment, chainId: 56 }, executor),
    ).toThrow(/another chain/u);
  });

  it("refuses an ERC-8183-bound mandate it cannot settle", () => {
    const bound = {
      ...message,
      commerceContract: mandateExecutor,
      commerceJobId: "4",
    };
    const job = jobWith({
      document: { primaryType: "TaskMandate", domain, message: bound },
      mandateHash: hashTypedData(getTaskMandateTypedData(bound, domain)),
    });
    expect(() => assertDrivableJob(job, deployment, executor)).toThrow(
      /ERC-8183/u,
    );
    const pinned = {
      ...deployment,
      settlement: {
        evaluator: { address: executor, codeHash: hash },
        commerce: {
          address: mandateExecutor,
          codeHash: hash,
          implementation: executor,
          implementationCodeHash: hash,
        },
        paymentToken: {
          address: executor,
          codeHash: hash,
          implementation: executor,
          implementationCodeHash: hash,
        },
        hook: { address: executor, codeHash: hash },
        provider: executor,
      },
    };
    expect(() => assertDrivableJob(job, pinned, executor)).not.toThrow();
    expect(() =>
      assertDrivableJob(
        job,
        {
          ...pinned,
          settlement: {
            ...pinned.settlement,
            commerce: { ...pinned.settlement.commerce, address: executor },
          },
        },
        executor,
      ),
    ).toThrow(/ERC-8183/u);
  });
});
