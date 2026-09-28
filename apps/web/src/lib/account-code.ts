import {
  type Address,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  semiModularAccountRuntimeCode,
} from "@perago/sdk";
import type { Hex } from "viem";

/** ERC-1967 implementation storage, not the immutable proxy runtime. */
export const ACCOUNT_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export class AccountCodeMismatchError extends Error {
  constructor() {
    super(
      "Smart account code or implementation does not match the pinned owner-bound deployment. Owner writes are disabled.",
    );
    this.name = "AccountCodeMismatchError";
  }
}

export function assertPinnedAccountCode(input: {
  owner: Address;
  code: Hex | undefined;
  implementation: Hex | undefined;
}): void {
  if (
    input.code?.toLowerCase() !==
      semiModularAccountRuntimeCode({ owner: input.owner }).toLowerCase() ||
    !input.implementation ||
    BigInt(input.implementation) !==
      BigInt(MODULAR_ACCOUNT_V2_ADDRESSES.semiModularAccountBytecode)
  ) {
    throw new AccountCodeMismatchError();
  }
}
