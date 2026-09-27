import {
  type ExecutionReceipt,
  executionReceiptSchema,
  type FaucetClaimResponse,
  type FaucetStatus,
  faucetClaimResponseSchema,
  faucetStatusSchema,
  mandateAcceptedSchema,
  mandatePreparedSchema,
  type PolicyView,
  type PublicConfig,
  policyListResponseSchema,
  policyTransitionConfirmedSchema,
  policyTransitionPreparedSchema,
  publicConfigSchema,
  REASON_MESSAGES,
  simulationCreatedSchema,
  type TaskDetail,
  type TaskSummary,
  taskCompiledSchema,
  taskDetailSchema,
  taskListResponseSchema,
  type WalletSessionView,
  walletChallengeResponseSchema,
  walletPolicyCreatedSchema,
  walletSessionSchema,
  walletSessionViewSchema,
} from "@perago/sdk";
import { API_URL } from "./env";

/*
 * The console's only door to the API. Every response is parsed with the SDK
 * schema the API itself is tested against, so a screen can never render a
 * field the contract does not define. A refusal becomes an `ApiError` that
 * keeps the stable reason code and its human sentence (PRD-F-016); a network
 * failure is an `ApiUnreachableError`, never a refusal.
 */

type Parser<T> = { parse: (input: unknown) => T };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string | null;
  readonly question: string | null;

  constructor(input: {
    code: string;
    status: number;
    message: string;
    detail: string | null;
    question: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.detail = input.detail;
    this.question = input.question;
  }

  /** The canonical sentence for a published code, else the API's message. */
  get sentence(): string {
    return isReasonCode(this.code) ? REASON_MESSAGES[this.code] : this.message;
  }
}

export class ApiUnreachableError extends Error {
  constructor() {
    super("The Perago API could not be reached. Nothing was changed.");
    this.name = "ApiUnreachableError";
  }
}

export function isReasonCode(
  code: string,
): code is keyof typeof REASON_MESSAGES {
  return Object.hasOwn(REASON_MESSAGES, code);
}

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function errorOf(status: number, body: unknown): ApiError {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const error =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : {};
  const code = text(error.code) ?? "INTERNAL_ERROR";
  return new ApiError({
    code,
    status,
    message: text(error.message) ?? "The API answered with an unexpected body.",
    detail: text(error.detail),
    question: text(record.question),
  });
}

async function request<T>(
  parser: Parser<T>,
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    token?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  const requestInit: RequestInit = {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    cache: "no-store",
  };
  if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, requestInit);
  } catch {
    throw new ApiUnreachableError();
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorOf(response.status, body);
  return parser.parse(body);
}

export const api = {
  config: (): Promise<PublicConfig> => request(publicConfigSchema, "/config"),

  challenge: (input: { account: `0x${string}`; rootOwner: `0x${string}` }) =>
    request(walletChallengeResponseSchema, "/auth/challenges", {
      body: { ...input, chainId: "97" },
    }),

  session: (input: { challengeId: string; signature: `0x${string}` }) =>
    request(walletSessionSchema, "/auth/sessions", { body: input }),

  whoami: (token: string): Promise<WalletSessionView> =>
    request(walletSessionViewSchema, "/auth/session", { token }),

  policies: async (token: string): Promise<PolicyView[]> =>
    (await request(policyListResponseSchema, "/policies", { token })).policies,

  createPolicy: (token: string, policy: unknown) =>
    request(walletPolicyCreatedSchema, "/policies", {
      token,
      body: { policy },
    }),

  prepareActivation: (token: string, policyId: string, transition: unknown) =>
    request(
      policyTransitionPreparedSchema,
      `/policies/${policyId}/activation/prepare`,
      { token, body: transition },
    ),

  confirmActivation: (token: string, policyId: string, body: unknown) =>
    request(
      policyTransitionConfirmedSchema,
      `/policies/${policyId}/activation`,
      {
        token,
        body,
        method: "PUT",
      },
    ),

  tasks: async (token: string): Promise<TaskSummary[]> =>
    (await request(taskListResponseSchema, "/tasks?limit=20", { token })).tasks,

  task: (token: string, taskId: string): Promise<TaskDetail> =>
    request(taskDetailSchema, `/tasks/${taskId}`, { token }),

  createTask: (token: string, body: unknown) =>
    request(taskCompiledSchema, "/tasks", { token, body }),

  simulate: (token: string, taskId: string) =>
    request(simulationCreatedSchema, `/tasks/${taskId}/simulations`, {
      token,
      body: {},
    }),

  prepareMandate: (token: string, taskId: string) =>
    request(mandatePreparedSchema, `/tasks/${taskId}/mandate/prepare`, {
      token,
      body: {},
    }),

  submitMandate: (token: string, taskId: string, signature: `0x${string}`) =>
    request(mandateAcceptedSchema, `/tasks/${taskId}/mandate`, {
      token,
      body: { signature },
    }),

  receipt: (mandateHash: string): Promise<ExecutionReceipt> =>
    request(executionReceiptSchema, `/receipts/${mandateHash}`),

  faucet: (token: string): Promise<FaucetStatus> =>
    request(faucetStatusSchema, "/faucet", { token }),

  claimFaucet: (token: string): Promise<FaucetClaimResponse> =>
    request(faucetClaimResponseSchema, "/faucet/claims", { token, body: {} }),
};
