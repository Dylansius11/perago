import { REASON_MESSAGES, type ReasonCode } from "@perago/sdk";

/**
 * A refusal the caller can act on, carrying a stable SDK reason code
 * (PRD-F-016). `detail` holds deterministic evidence such as a decoded revert
 * name; it never carries secrets or model prose.
 */
export class ReasonError extends Error {
  constructor(
    readonly code: ReasonCode,
    readonly detail: string | null = null,
  ) {
    super(REASON_MESSAGES[code]);
    this.name = "ReasonError";
  }
}
