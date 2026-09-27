import { describe, expect, it } from "vitest";

import {
  assertCommerceJobIdentity,
  assertSubmittedCommerceJob,
} from "../src/index.js";

const account = "0x1111111111111111111111111111111111111111";
const provider = "0x2222222222222222222222222222222222222222";
const evaluator = "0x3333333333333333333333333333333333333333";
const hook = "0x4444444444444444444444444444444444444444";
const paymentToken = "0x5555555555555555555555555555555555555555";
const job = {
  id: 7n,
  client: account,
  provider,
  evaluator,
  hook,
  budget: 10n,
  status: 2,
  expiredAt: 1_601n,
};
const binding = {
  jobId: 7n,
  account,
  provider,
  evaluator,
  hook,
  paymentToken,
  actualPaymentToken: paymentToken,
  platformFeeBP: 0n,
  mandateExpiresAt: 880n,
  executionWindowSeconds: 600n,
  now: 1n,
  job,
};

describe("submitted commerce job preflight", () => {
  it("accepts only a funded submitted job with sufficient execution and confirmation headroom", () => {
    expect(() => assertSubmittedCommerceJob(binding)).not.toThrow();
    expect(() =>
      assertSubmittedCommerceJob({
        ...binding,
        job: { ...job, expiredAt: 1_600n },
      }),
    ).toThrow(/deadline/u);
  });

  it("preserves binding and payment terms after the job becomes Funded or Completed", () => {
    expect(() =>
      assertCommerceJobIdentity({ ...binding, job: { ...job, status: 1 } }),
    ).not.toThrow();
    expect(() =>
      assertCommerceJobIdentity({ ...binding, job: { ...job, status: 3 } }),
    ).not.toThrow();
    expect(() =>
      assertCommerceJobIdentity({ ...binding, platformFeeBP: 100n }),
    ).not.toThrow();
    expect(() =>
      assertCommerceJobIdentity({
        ...binding,
        job: { ...job, status: 1, provider: account },
      }),
    ).toThrow(/provider/u);
  });
  it.each([
    ["job identity", { job: { ...job, id: 8n } }],
    ["client", { job: { ...job, client: provider } }],
    ["provider", { job: { ...job, provider: account } }],
    ["evaluator", { job: { ...job, evaluator: account } }],
    ["hook", { job: { ...job, hook: account } }],
    ["budget", { job: { ...job, budget: 0n } }],
    ["status", { job: { ...job, status: 1 } }],
    ["payment token", { actualPaymentToken: account }],
    ["platform fee", { platformFeeBP: 100n }],
  ])("rejects a changed %s before signing", (_name, change) => {
    let refusal: unknown;
    try {
      assertSubmittedCommerceJob({ ...binding, ...change });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ name: "CommerceJobMismatchError" });
  });
});
