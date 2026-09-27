import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from "viem";
import { AccountCodeMismatchError } from "./account-code";
import { ApiError, ApiUnreachableError } from "./api";
import { VenueMismatchError } from "./venue";

/*
 * Every failure the console can show, reduced to one shape: a stable code,
 * one plain sentence, and whether retrying the same step is safe. A generic
 * "something went wrong" is a defect (docs/DESIGN-SYSTEM.md §7).
 */
export type Failure = {
  code: string;
  sentence: string;
  detail: string | null;
  retry: boolean;
};

function walk(error: unknown, test: (value: unknown) => boolean): boolean {
  if (error instanceof BaseError) return error.walk(test) !== null;
  return test(error);
}

const rejected = (value: unknown) =>
  value instanceof UserRejectedRequestError ||
  (typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code: unknown }).code === 4001);

export function toFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      sentence: error.sentence,
      detail: error.question ?? error.detail,
      retry: error.status >= 500 || error.code === "CHAIN_UNAVAILABLE",
    };
  }
  if (error instanceof ApiUnreachableError) {
    return {
      code: "API_UNREACHABLE",
      sentence: error.message,
      detail: "Check that the API is running, then retry.",
      retry: true,
    };
  }
  if (error instanceof AccountCodeMismatchError) {
    return {
      code: "ACCOUNT_CODE_MISMATCH",
      sentence: error.message,
      detail:
        "Do not sign for this account. Check the configured chain and deployed contract before retrying.",
      retry: false,
    };
  }
  if (error instanceof VenueMismatchError) {
    return {
      code: "CHAIN_MISMATCH",
      sentence: error.message,
      detail:
        "Switch the wallet to the same BSC Testnet history this console reads, then retry.",
      retry: true,
    };
  }
  if (walk(error, rejected)) {
    return {
      code: "WALLET_REJECTED",
      sentence:
        "You declined the request in your wallet. Nothing was signed or sent.",
      detail: null,
      retry: true,
    };
  }
  if (walk(error, (value) => value instanceof InsufficientFundsError)) {
    return {
      code: "OWNER_GAS_SHORT",
      sentence: "Your wallet does not hold enough tBNB to pay the network fee.",
      detail: "Fund the owner wallet from a BSC Testnet faucet, then retry.",
      retry: true,
    };
  }
  if (error instanceof BaseError) {
    const revert = error.walk(
      (value) => value instanceof ContractFunctionRevertedError,
    );
    if (revert instanceof ContractFunctionRevertedError) {
      return {
        code: "CHAIN_REVERTED",
        sentence: `The chain refused the call${revert.data?.errorName ? ` with ${revert.data.errorName}` : ""}. Nothing changed.`,
        detail: revert.shortMessage,
        retry: false,
      };
    }
    return {
      code: "CHAIN_ERROR",
      sentence: error.shortMessage,
      detail: null,
      retry: true,
    };
  }
  if (error instanceof Error && error.name === "OperationFailedError") {
    return {
      code: "USER_OPERATION_FAILED",
      sentence: error.message,
      detail: null,
      retry: false,
    };
  }
  return {
    code: "UNEXPECTED",
    sentence:
      error instanceof Error
        ? error.message
        : "An unexpected error stopped this step.",
    detail: null,
    retry: true,
  };
}
