"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink, Label } from "../console/ui";

/** Where a task page points a skeptic: copy the address or open the wallet-free page. */
export function PublicReceiptLink({ mandateHash }: { mandateHash: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_400);
    return () => clearTimeout(timer);
  }, [copied]);
  const path = `/r/${mandateHash}`;
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <Label>Public receipt</Label>
      <p className="mt-2 max-w-[60ch] text-[13px] text-fog">
        Anyone can open this page without a wallet or a login.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(`${window.location.origin}${path}`)
              .then(() => setCopied(true));
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </Button>
        <ButtonLink href={path} variant="ghost" external arrow>
          Open
        </ButtonLink>
      </div>
    </div>
  );
}
