import { z } from "zod";
import { uint256StringSchema } from "../domain/primitives.js";
import { taskIntentSchema } from "../domain/task-intent.js";

/**
 * `clientRequestId` is the idempotency key scoped to the authenticated wallet.
 * The API adds the commitment salt; clients never choose it.
 */
export const createTaskRequestSchema = z.strictObject({
  clientRequestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,128}$/u, "expected an 8-128 character request id"),
  intent: taskIntentSchema.omit({ salt: true }),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** User-selected, pre-funded/submitted APEX job; never a worker-chosen verdict. */
export const simulateTaskRequestSchema = z.strictObject({
  commerceJobId: uint256StringSchema
    .refine((value) => value !== "0", "commerce job ID must be positive")
    .optional(),
});

export type SimulateTaskRequest = z.infer<typeof simulateTaskRequestSchema>;
