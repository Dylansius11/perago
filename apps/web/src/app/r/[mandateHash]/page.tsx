import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { ReceiptView } from "@/components/receipt/receipt-view";

/*
 * Public and wallet-free: this route sits outside the (console) group, so it
 * ships no wagmi, session, or wallet code. A judge reaches it from a QR code.
 */
const DESCRIPTION =
  "A public receipt for one Perago mandate on BNB Smart Chain Testnet: the verdict, the transactions, and how to check them yourself.";

/* A page-level openGraph replaces the root one, so the brand image is restated. */
const SHARE_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Perago. Give the goal, not the wallet.",
};

export const metadata: Metadata = {
  title: "Receipt",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Perago",
    title: "Receipt · Perago",
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Receipt · Perago",
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ mandateHash: string }>;
}) {
  const { mandateHash } = await params;
  return (
    <>
      <header className="border-b border-ruleinvert bg-paper">
        <div className="flex h-16 items-stretch">
          <Link
            href="/"
            aria-label="Perago home"
            className="pressable flex shrink-0 items-center border-r border-ruleinvert px-4 hover:bg-ink/[0.03] md:w-52 md:px-5"
          >
            <Wordmark size="md" className="[&>span]:hidden md:[&>span]:block" />
          </Link>
          <div className="min-w-0 flex-1" />
          <div className="flex items-center gap-2.5 border-l border-rule px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-fog sm:text-[11px] sm:tracking-[0.16em] md:px-5">
            <span aria-hidden className="size-1.5 shrink-0 bg-fog" />
            Public receipt
          </div>
        </div>
      </header>
      <main className="min-h-[calc(100dvh-4rem)] bg-paper">
        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 md:px-10 md:pt-10">
          <ReceiptView mandateHash={mandateHash} />
        </div>
      </main>
    </>
  );
}
