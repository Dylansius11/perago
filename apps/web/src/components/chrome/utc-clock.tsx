"use client";

import { useEffect, useState } from "react";

/*
 * Live UTC clock for the top bar. Renders a placeholder that matches the
 * server markup, then swaps to the real time after mount; the transition
 * never fights hydration.
 */
export function UtcClock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setNow(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "UTC",
        }).format(new Date()),
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span suppressHydrationWarning>
      {now ? `${now} UTC \u00B7 ` : "00:00:00 UTC \u00B7 "}
      BSC Testnet
    </span>
  );
}
