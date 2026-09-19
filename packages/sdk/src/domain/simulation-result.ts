import { z } from "zod";

import {
  adapterIdSchema,
  addressSchema,
  hashSchema,
  uint48StringSchema,
  uint256StringSchema,
} from "./primitives.js";

export const simulationResultSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  status: z.enum(["PASSED", "REVERTED", "STALE", "ERROR"]),
  chainId: uint256StringSchema,
  planHash: hashSchema,
  actionHash: hashSchema,
  adapterId: adapterIdSchema,
  adapterCodeHash: hashSchema,
  blockNumber: uint256StringSchema,
  blockHash: hashSchema,
  quoteExpiresAt: uint48StringSchema,
  inputBalance: uint256StringSchema,
  maxInput: uint256StringSchema,
  minOutput: uint256StringSchema,
  recipient: addressSchema,
  risks: z.array(z.string().trim().min(1).max(500)),
});

export type SimulationResult = z.infer<typeof simulationResultSchema>;
