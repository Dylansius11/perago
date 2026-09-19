import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  selectorSchema,
  uint48StringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from "./primitives.js";

export const taskMandateSchema = z.strictObject({
  account: addressSchema,
  rootOwner: addressSchema,
  ownerEpoch: uint64StringSchema,
  executor: addressSchema,
  chainId: uint256StringSchema,
  nonce: uint256StringSchema,
  expiresAt: uint48StringSchema,
  policyHash: hashSchema,
  intentHash: hashSchema,
  planHash: hashSchema,
  simulationHash: hashSchema,
  adapter: addressSchema,
  adapterSelector: selectorSchema,
  inputToken: addressSchema,
  maxInput: uint256StringSchema,
  outputToken: addressSchema,
  minOutput: uint256StringSchema,
  recipient: addressSchema,
  actionHash: hashSchema,
  postconditionHash: hashSchema,
  commerceContract: addressSchema,
  commerceJobId: uint256StringSchema,
});

export type TaskMandate = z.infer<typeof taskMandateSchema>;
