import { z } from "zod";

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
