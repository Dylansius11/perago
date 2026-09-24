import { z } from "zod";

import { signatureSchema } from "./auth.js";

/** The root owner's EIP-712 signature over the prepared Task Mandate. */
export const submitMandateSignatureRequestSchema = z.strictObject({
  signature: signatureSchema,
});

export type SubmitMandateSignatureRequest = z.infer<
  typeof submitMandateSignatureRequestSchema
>;
