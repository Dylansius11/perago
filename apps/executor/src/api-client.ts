import {
  type DeferExecutionRequest,
  type ExecutionJob,
  executionJobResponseSchema,
  type Hash,
  leaseExecutionResponseSchema,
  type RecordPendingTransactionRequest,
} from "@perago/sdk";
import type { z } from "zod";

/** Another worker holds this job now; the caller must stop touching it. */
export class LeaseLostError extends Error {
  readonly mandateHash: Hash;

  constructor(mandateHash: Hash) {
    super(`lease lost for ${mandateHash}`);
    this.name = "LeaseLostError";
    this.mandateHash = mandateHash;
  }
}

/** The API refused a request; `code` is its stable error code. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}
export type ExecutionApi = {
  lease(): Promise<ExecutionJob | null>;
  reconcile(mandateHash: Hash): Promise<ExecutionJob>;
  recordPending(
    mandateHash: Hash,
    request: Omit<RecordPendingTransactionRequest, "workerId">,
  ): Promise<ExecutionJob>;
  retireReplaced(
    mandateHash: Hash,
    transactionHash: Hash,
  ): Promise<ExecutionJob>;
  defer(
    mandateHash: Hash,
    request: Omit<DeferExecutionRequest, "workerId">,
  ): Promise<ExecutionJob>;
  release(mandateHash: Hash): Promise<ExecutionJob>;
};

function errorOf(body: unknown): { code: string; message: string } {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null
  ) {
    const code =
      "code" in body.error && typeof body.error.code === "string"
        ? body.error.code
        : "UNKNOWN";
    const message =
      "message" in body.error && typeof body.error.message === "string"
        ? body.error.message
        : "";
    return { code, message };
  }
  return { code: "UNKNOWN", message: "" };
}

/**
 * The worker's only path to durable state: internal API routes authenticated
 * by the worker token. Every response is parsed against the SDK contract.
 */
export function createExecutionApi(input: {
  apiUrl: URL;
  workerToken: string;
  workerId: string;
  fetch?: typeof fetch;
}): ExecutionApi {
  const send = input.fetch ?? fetch;

  async function call<T extends z.ZodType>(
    path: string,
    body: Record<string, unknown>,
    schema: T,
    mandateHash: Hash | null,
  ): Promise<z.infer<T>> {
    const response = await send(
      new URL(`internal/executions/${path}`, input.apiUrl),
      {
        body: JSON.stringify({ ...body, workerId: input.workerId }),
        headers: {
          authorization: `Bearer ${input.workerToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    const parsed: unknown = await response.json();
    if (!response.ok) {
      const { code, message } = errorOf(parsed);
      if (code === "LEASE_LOST" && mandateHash)
        throw new LeaseLostError(mandateHash);
      throw new ApiRequestError(response.status, code, message);
    }
    return schema.parse(parsed);
  }

  const job = async (
    mandateHash: Hash,
    path: string,
    body: Record<string, unknown> = {},
  ) =>
    (
      await call(
        `${mandateHash}/${path}`,
        body,
        executionJobResponseSchema,
        mandateHash,
      )
    ).job;

  return {
    lease: async () =>
      (await call("lease", {}, leaseExecutionResponseSchema, null)).job,
    reconcile: (mandateHash) => job(mandateHash, "reconcile"),
    recordPending: (mandateHash, request) =>
      job(mandateHash, "pending", request),
    retireReplaced: (mandateHash, transactionHash) =>
      job(mandateHash, "pending/retire", { transactionHash }),
    defer: (mandateHash, request) => job(mandateHash, "defer", request),
    release: (mandateHash) => job(mandateHash, "release"),
  };
}
