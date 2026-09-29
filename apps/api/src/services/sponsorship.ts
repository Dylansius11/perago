import {
  type Address,
  type EstimateUserOperationResponse,
  type Hash,
  hashSchema,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  modularAccountAbi,
  packUserOperationSignature,
  type SubmitUserOperationResponse,
  type UserOperationRequest,
  type UserOperationStatus,
} from "@perago/sdk";
import {
  type Abi,
  decodeFunctionData,
  getAbiItem,
  type Hex,
  isAddressEqual,
  numberToHex,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { z } from "zod";

import { ReasonError } from "../errors.js";

/*
 * The sponsored root path. The owner still signs the EntryPoint hash, but the
 * API submits that signed operation to an Alchemy bundler whose gas manager
 * pays for it, so the owner's wallet never broadcasts `handleOps` and never
 * prompts a second time. Two rules keep the sponsorship bounded:
 *
 *   - the API sponsors only the exact call shapes the console root-signs, and
 *     only for the account that owns the wallet session (never a body field);
 *   - the bundler URL carries an API key, so no error, log, or response may
 *     repeat it or the gas-manager policy id.
 *
 * When the bundler refuses, the caller falls back to the owner-paid path with
 * the same signed operation: the refusal is a reason code, not a failed action.
 */

/** The bundler JSON-RPC call. Injected so tests never touch the network. */
export type BundlerRpc = (request: {
  method: string;
  params: unknown[];
}) => Promise<unknown>;

/** A bundler answer the API could not read or use. */
export class BundlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundlerError";
  }
}

const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
]);
const wbnbAbi = parseAbi(["function deposit() payable"]);

const selectors = {
  approve: toFunctionSelector(
    getAbiItem({ abi: erc20ApproveAbi, name: "approve" }),
  ),
  deposit: toFunctionSelector(getAbiItem({ abi: wbnbAbi, name: "deposit" })),
  execute: toFunctionSelector(
    getAbiItem({ abi: modularAccountAbi, name: "execute" }),
  ),
  executeBatch: toFunctionSelector(
    getAbiItem({ abi: modularAccountAbi, name: "executeBatch" }),
  ),
  installValidation: toFunctionSelector(
    getAbiItem({ abi: modularAccountAbi, name: "installValidation" }),
  ),
  revoke: toFunctionSelector(
    getAbiItem({ abi: mandateExecutorAbi, name: "revoke" }),
  ),
  setAccountPolicy: toFunctionSelector(
    getAbiItem({ abi: mandateExecutorAbi, name: "setAccountPolicy" }),
  ),
  uninstallValidation: toFunctionSelector(
    getAbiItem({ abi: modularAccountAbi, name: "uninstallValidation" }),
  ),
};

/** Limits for the estimation request; the bundler measures and replaces them. */
const ESTIMATION_GAS = {
  callGasLimit: 500_000n,
  preVerificationGas: 150_000n,
  verificationGasLimit: 900_000n,
} as const;

/** A structurally valid signature used only for gas estimation. */
const DUMMY_SIGNATURE = packUserOperationSignature(
  `0x${"11".repeat(32)}${"22".repeat(32)}1c`,
);

/** The bundler rejects over-provisioned limits, so the buffer stays small. */
const BUFFER_PERCENT = 115n;

const DEFAULT_HOURLY_SEND_LIMIT = 20;
const HOUR_MS = 3_600_000;
const ERROR_LIMIT = 400;

const hexQuantitySchema = z
  .string()
  .regex(/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/u, "expected a 0x hex quantity");

const estimateResponseSchema = z.object({
  callGasLimit: hexQuantitySchema,
  preVerificationGas: hexQuantitySchema,
  verificationGasLimit: hexQuantitySchema,
});

const userOperationReceiptSchema = z.object({
  receipt: z.object({ transactionHash: hashSchema }),
  success: z.boolean(),
});

/**
 * Reads a bundler answer before anything was sent (an estimate or a receipt
 * lookup). An unreadable one is an unavailable bundler, which the console
 * answers by letting the owner pay.
 */
function readBundlerAnswer<T>(schema: z.ZodType<T>, answer: unknown): T {
  const parsed = schema.safeParse(answer);
  if (parsed.success) return parsed.data;
  throw new ReasonError(
    "SPONSORSHIP_UNAVAILABLE",
    "the bundler's answer was unreadable",
  );
}

/** Bounds a bundler message and removes anything the bundler echoed back. */
function redact(text: string, secrets: readonly string[]): string {
  let safe = text;
  for (const secret of secrets)
    if (secret.length > 0) safe = safe.replaceAll(secret, "[redacted]");
  return safe.length > ERROR_LIMIT ? `${safe.slice(0, ERROR_LIMIT)}…` : safe;
}

function describeBundlerError(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null)
    return "the bundler refused the request";
  const record = error as { code?: unknown; data?: unknown; message?: unknown };
  const text = [record.message, record.data]
    .map((part) =>
      typeof part === "string"
        ? part
        : part === undefined
          ? ""
          : JSON.stringify(part),
    )
    .filter((part) => part.length > 0)
    .join(" ");
  const code =
    record.code === undefined ? "" : ` (code ${String(record.code)})`;
  return text.length > 0
    ? `${text}${code}`
    : `the bundler refused the request${code}`;
}

/** Everything a bundler could echo: the policy id, the URL, and its segments. */
function secretsOf(url: string, policyId: string): string[] {
  const secrets = [policyId, url];
  try {
    for (const segment of new URL(url).pathname.split("/"))
      if (segment.length > 0) secrets.push(segment);
  } catch {
    // A malformed URL never reaches this module; the config loader rejects it.
  }
  return secrets;
}

/**
 * One Alchemy bundler endpoint. The gas-manager policy id travels in a header
 * so every submission is sponsored under the reviewed policy, and an error
 * payload is redacted before it can reach a log or a response body.
 */
export function createAlchemyBundlerRpc(input: {
  policyId: string;
  url: string;
}): BundlerRpc {
  const secrets = secretsOf(input.url, input.policyId);
  return async (request) => {
    let response: Response;
    try {
      response = await fetch(input.url, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: request.method,
          params: request.params,
        }),
        headers: {
          "content-type": "application/json",
          "x-alchemy-policy-id": input.policyId,
        },
        method: "POST",
      });
    } catch {
      throw new BundlerError(`${request.method} could not reach the bundler`);
    }
    if (!response.ok)
      throw new BundlerError(
        `${request.method} failed with HTTP ${response.status}`,
      );
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
      result?: unknown;
    } | null;
    if (payload === null || typeof payload !== "object")
      throw new BundlerError(
        `${request.method} returned a body that is not JSON`,
      );
    if (payload.error !== undefined && payload.error !== null)
      throw new BundlerError(
        redact(describeBundlerError(payload.error), secrets),
      );
    return payload.result;
  };
}

/** The accounts, contracts, and tokens a sponsored call may name. */
export type SponsorableCallScope = {
  account: Address;
  mandateExecutor: Address;
  tokens: readonly Address[];
  wbnb: Address;
};

export type SponsorshipService = {
  /** Gas limits for a sponsored operation, measured from the session account. */
  estimate: (input: {
    account: Address;
    callData: Hex;
    nonce: bigint;
  }) => Promise<EstimateUserOperationResponse>;
  submit: (input: {
    account: Address;
    userOperation: UserOperationRequest;
  }) => Promise<SubmitUserOperationResponse>;
  status: (userOperationHash: Hash) => Promise<UserOperationStatus>;
};

export type SponsorshipServiceConfig = {
  /** Defaults to the pinned Alchemy EntryPoint v0.7 deployment. */
  entryPoint?: Address;
  /** Sponsored sends per smart account in a rolling hour; defaults to 20. */
  hourlySendLimit?: number;
  mandateExecutor: Address;
  now?: () => number;
  tokens: readonly Address[];
  wbnb: Address;
};

function refused(detail: string): never {
  throw new ReasonError("SPONSORSHIP_REFUSED", detail);
}

/** Decodes calldata, refusing (never a server error) what it cannot read. */
function decodeOrRefuse<const abi extends Abi>(abi: abi, data: Hex) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return refused(`the call ${data.slice(0, 10)} is unreadable`);
  }
}

/** One call inside the account batch, checked against the sponsorable shapes. */
function assertAccountCall(
  call: { data: Hex; target: Address; value: bigint },
  scope: SponsorableCallScope,
): void {
  const selector = call.data.slice(0, 10).toLowerCase();
  if (isAddressEqual(call.target, scope.account)) {
    if (
      call.value !== 0n ||
      (selector !== selectors.installValidation &&
        selector !== selectors.uninstallValidation)
    )
      refused(
        `the account may only install or uninstall its mandate session, not ${selector}`,
      );
    return;
  }
  if (isAddressEqual(call.target, scope.mandateExecutor)) {
    if (call.value !== 0n)
      refused("a MandateExecutor call may not carry native value");
    if (
      selector !== selectors.setAccountPolicy &&
      selector !== selectors.revoke
    )
      refused(`MandateExecutor ${selector} is not a sponsored call`);
    return;
  }
  if (scope.tokens.some((token) => isAddressEqual(token, call.target))) {
    if (call.value !== 0n)
      refused("a token approval may not carry native value");
    if (selector !== selectors.approve)
      refused(
        `only approve(...) is sponsored on a catalog token, not ${selector}`,
      );
    const { args } = decodeOrRefuse(erc20ApproveAbi, call.data);
    if (!isAddressEqual(args[0], scope.mandateExecutor))
      refused(
        "a sponsored approval may only name MandateExecutor as its spender",
      );
    return;
  }
  if (isAddressEqual(call.target, scope.wbnb)) {
    if (call.value === 0n) refused("a WBNB deposit must carry native value");
    if (call.data.toLowerCase() !== selectors.deposit)
      refused(`only WBNB.deposit() is sponsored, not ${selector}`);
    return;
  }
  refused(
    `target ${call.target} is not the account, MandateExecutor, a catalog token, or WBNB`,
  );
}

/**
 * Refuses any account call the sponsored path must not submit. The session
 * account is never taken from the request: it comes from the wallet session.
 */
export function assertSponsorableCall(
  input: SponsorableCallScope & { callData: Hex },
): void {
  const selector = input.callData.slice(0, 10).toLowerCase();
  if (selector === selectors.execute) {
    const decoded = decodeOrRefuse(modularAccountAbi, input.callData);
    if (decoded.functionName !== "execute")
      refused("the account call is unreadable");
    const [target, value, data] = decoded.args;
    assertAccountCall({ data, target, value }, input);
    return;
  }
  if (selector === selectors.executeBatch) {
    const decoded = decodeOrRefuse(modularAccountAbi, input.callData);
    if (decoded.functionName !== "executeBatch")
      refused("the account call is unreadable");
    const [calls] = decoded.args;
    if (calls.length === 0) refused("an empty batch is not sponsored");
    for (const call of calls) assertAccountCall(call, input);
    return;
  }
  refused(`the account call must be execute or executeBatch, not ${selector}`);
}

function toRpc(userOperation: {
  callData: Hex;
  callGasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: bigint;
  preVerificationGas: bigint;
  sender: Address;
  signature: Hex;
  verificationGasLimit: bigint;
}): Record<string, string> {
  return {
    callData: userOperation.callData,
    callGasLimit: numberToHex(userOperation.callGasLimit),
    maxFeePerGas: numberToHex(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: numberToHex(userOperation.maxPriorityFeePerGas),
    nonce: numberToHex(userOperation.nonce),
    preVerificationGas: numberToHex(userOperation.preVerificationGas),
    sender: userOperation.sender,
    signature: userOperation.signature,
    verificationGasLimit: numberToHex(userOperation.verificationGasLimit),
  };
}

/** A sponsored estimate that the bundler will not call inefficient. */
function withBuffer(estimate: string): Hex {
  return numberToHex((BigInt(estimate) * BUFFER_PERCENT) / 100n);
}

/**
 * Sponsorship for one API process: gas estimation, submission, and receipt
 * lookup for the exact call shapes above. The rolling send limit lives in
 * memory, so it bounds abuse per process rather than across a replica set; the
 * bundler's own gas-manager policy remains the authority on spending.
 */
export function createSponsorship(
  config: SponsorshipServiceConfig,
  rpc: BundlerRpc,
): SponsorshipService {
  const entryPoint =
    config.entryPoint ?? MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;
  const hourlySendLimit = config.hourlySendLimit ?? DEFAULT_HOURLY_SEND_LIMIT;
  if (!Number.isInteger(hourlySendLimit) || hourlySendLimit <= 0)
    throw new RangeError("the sponsored send limit must be a positive integer");
  const now = config.now ?? (() => Date.now());
  const scope: Omit<SponsorableCallScope, "account"> = {
    mandateExecutor: config.mandateExecutor,
    tokens: config.tokens,
    wbnb: config.wbnb,
  };
  /** Sponsored send timestamps per smart account, this process only. */
  const sends = new Map<string, number[]>();

  async function call(method: string, params: unknown[]): Promise<unknown> {
    try {
      return await rpc({ method, params });
    } catch (error) {
      if (!(error instanceof BundlerError)) throw error;
      throw new ReasonError("SPONSORSHIP_UNAVAILABLE", error.message);
    }
  }

  function withinHourlyLimit(account: Address): boolean {
    const key = account.toLowerCase();
    const cutoff = now() - HOUR_MS;
    const recent = (sends.get(key) ?? []).filter((at) => at > cutoff);
    sends.set(key, recent);
    return recent.length < hourlySendLimit;
  }

  return {
    async estimate(input) {
      assertSponsorableCall({
        ...scope,
        account: input.account,
        callData: input.callData,
      });
      const measured = readBundlerAnswer(
        estimateResponseSchema,
        await call("eth_estimateUserOperationGas", [
          toRpc({
            callData: input.callData,
            nonce: input.nonce,
            sender: input.account,
            signature: DUMMY_SIGNATURE,
            ...ESTIMATION_GAS,
            // A sponsored operation carries zero fees; the paymaster pays.
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
          }),
          entryPoint,
        ]),
      );
      return {
        callGasLimit: withBuffer(measured.callGasLimit),
        preVerificationGas: withBuffer(measured.preVerificationGas),
        verificationGasLimit: withBuffer(measured.verificationGasLimit),
      };
    },

    async submit(input) {
      const { userOperation } = input;
      assertSponsorableCall({
        ...scope,
        account: input.account,
        callData: userOperation.callData,
      });
      if (!isAddressEqual(userOperation.sender, input.account))
        refused(
          `a sponsored operation must be sent by the session account, not ${userOperation.sender}`,
        );
      if (
        BigInt(userOperation.maxFeePerGas) !== 0n ||
        BigInt(userOperation.maxPriorityFeePerGas) !== 0n
      )
        refused("a sponsored operation must carry zero fees");
      if (!withinHourlyLimit(input.account))
        throw new ReasonError(
          "SPONSORSHIP_UNAVAILABLE",
          "this smart account reached its sponsored send limit for the last hour",
        );
      // The request schema already holds JSON-RPC hex fields, so it goes out unchanged.
      const userOperationHash = await call("eth_sendUserOperation", [
        userOperation,
        entryPoint,
      ]);
      sends.get(input.account.toLowerCase())?.push(now());
      // The operation may already be pending, so an unreadable answer must not
      // be a refusal that invites an owner-paid resend of the same operation.
      const parsed = hashSchema.safeParse(userOperationHash);
      if (!parsed.success)
        throw new BundlerError(
          "the bundler's answer to a sent operation was unreadable",
        );
      return { userOperationHash: parsed.data };
    },

    async status(userOperationHash) {
      const receipt = await call("eth_getUserOperationReceipt", [
        userOperationHash,
      ]);
      if (receipt === null || receipt === undefined)
        return { status: "PENDING" };
      const included = readBundlerAnswer(userOperationReceiptSchema, receipt);
      return {
        status: "INCLUDED",
        success: included.success,
        transactionHash: included.receipt.transactionHash,
      };
    },
  };
}
