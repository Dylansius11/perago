import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * The brand lockup, drawn in code: the mark image plus a typographic
 * wordmark. The supplied lockup PNG renders its wordmark in white, which
 * disappears on paper surfaces, so the wordmark is set in the site's
 * display face instead and themed per surface. One component, two tones.
 */

const tones = {
  ink: "text-ink",
  paper: "text-paper",
} as const;

const sizes = {
  sm: { icon: "h-8 w-auto", text: "text-[19px]" },
  md: { icon: "h-14 w-auto", text: "text-[24px]" },
  lg: { icon: "h-16 w-auto", text: "text-[40px]" },
} as const;

export function Wordmark({
  tone = "ink",
  size = "md",
  className,
}: {
  tone?: keyof typeof tones;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <Image
        src="/brand/icon-mark.png"
        alt=""
        width={949}
        height={1142}
        className={sizes[size].icon}
        priority
      />
      <span
        className={cn(
          "font-sans font-semibold leading-none tracking-[-0.02em]",
          tones[tone],
          sizes[size].text,
        )}
      >
        Perago
      </span>
    </span>
  );
}
