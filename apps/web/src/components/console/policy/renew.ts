/*
 * When the owner is offered a one-step renewal. A session lasts 24 hours; the
 * button appears once it has ended and for the last two hours, early enough
 * that nobody finds Perago unable to act at the moment they need it.
 */

export const RENEW_WINDOW_SECONDS = 7_200;

export type RenewState = "ended" | "ending" | null;

/** `secondsLeft` is the time to the session's end, or null when the policy has none. */
export function renewState(secondsLeft: number | null): RenewState {
  if (secondsLeft === null) return null;
  if (secondsLeft <= 0) return "ended";
  return secondsLeft < RENEW_WINDOW_SECONDS ? "ending" : null;
}
