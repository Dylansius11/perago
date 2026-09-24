import { defineSwapJourney } from "./swap-journey.js";

/**
 * P4-003 on live chain 97 against the `testnet-demo` MandateExecutor
 * (`SC-D-006`). Spends testnet gas from the disposable owner and executor keys.
 */
defineSwapJourney("testnet");
