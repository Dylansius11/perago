"use client";

import { useEffect, useState } from "react";

/*
 * Live UTC clock for the top bar. Until the real time is known it renders
 * dashes, matching the server markup, then swaps after mount; a fake
 * 00:00:00 is never shown as a time and the swap never fights hydration.
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
      {now ? `${now} UTC \u00B7 ` : "--:--:-- UTC \u00B7 "}
      BSC Testnet
    </span>
  );
}
