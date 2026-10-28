import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";

/*
 * The brand lockup, drawn in code: the mark plus a typographic wordmark. The
 * supplied lockup PNG renders its wordmark in white, which disappears on
 * paper surfaces, so the wordmark is set in the site's display face instead
 * and themed per surface. One component, two tones.
 */

const tones = {
  ink: "text-ink",
  paper: "text-paper",
} as const;

const sizes = {
  sm: { icon: "h-5", text: "text-[19px]", gap: "gap-2.5" },
  md: { icon: "h-7", text: "text-[24px]", gap: "gap-3" },
  lg: { icon: "h-11", text: "text-[40px]", gap: "gap-4" },
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
  const scale = sizes[size];
  return (
    <span className={cn("flex items-center", scale.gap, className)}>
      <BrandMark className={cn("aspect-[460/504] w-auto", scale.icon)} />
      <span
        className={cn(
          "font-sans font-semibold leading-none tracking-[-0.02em]",
          tones[tone],
          scale.text,
        )}
      >
        Perago
      </span>
    </span>
  );
}
