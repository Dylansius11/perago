/** Only the fields that affect whether the pinned APEX evaluator can pay. */
export type CommerceJob = {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  hook: string;
  budget: bigint;
  status: number;
  expiredAt: bigint;
};

export type CommerceJobPreflight = {
  job: CommerceJob;
  jobId: bigint;
  account: string;
  provider: string;
  evaluator: string;
  hook: string;
  paymentToken: string;
  actualPaymentToken: string;
  platformFeeBP: bigint;
  mandateExpiresAt: bigint;
  executionWindowSeconds: bigint;
  now: bigint;
};

const equal = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** Distinguishes a deterministic mismatch from an RPC/implementation failure. */
export class CommerceJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceJobMismatchError";
  }
}

/** Identity and escrow terms must hold even when APEX changes job status. */
export function assertCommerceJobIdentity(input: CommerceJobPreflight): void {
  const { job } = input;
  if (job.id !== input.jobId || input.jobId === 0n)
    throw new CommerceJobMismatchError("commerce job identity changed");
  if (!equal(job.client, input.account))
    throw new CommerceJobMismatchError("commerce job client changed");
  if (!equal(job.provider, input.provider))
    throw new CommerceJobMismatchError("commerce job provider changed");
  if (!equal(job.evaluator, input.evaluator))
    throw new CommerceJobMismatchError("commerce job evaluator changed");
  if (!equal(job.hook, input.hook))
    throw new CommerceJobMismatchError("commerce job hook changed");
  if (
    !equal(input.actualPaymentToken, input.paymentToken) ||
    input.platformFeeBP !== 0n
  )
    throw new CommerceJobMismatchError("commerce payment terms changed");
  if (job.budget === 0n)
    throw new CommerceJobMismatchError("commerce job has no escrow budget");
}

/** The kernel owns state; this gate never claims payment or authorizes a job. */
export function assertSubmittedCommerceJob(input: CommerceJobPreflight): void {
  assertCommerceJobIdentity(input);
  if (input.job.status !== 2)
    throw new CommerceJobMismatchError("commerce job is not submitted");
  if (
    input.job.expiredAt <= input.now ||
    input.job.expiredAt <=
      input.mandateExpiresAt + input.executionWindowSeconds + 120n
  )
    throw new CommerceJobMismatchError(
      "commerce job deadline lacks execution headroom",
    );
}
