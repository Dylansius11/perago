import { cn } from "@/lib/utils";

/*
 * The grid rail: the structural device of the whole design. A column is
 * either a hairline edge (the COLUMNS variant) or a filled block (INK).
 * Sections compose them; nothing invents a second border convention.
 */

const railVariants = {
  COLUMNS: "flex-1 border-l border-rule",
  INK: "flex-1 bg-ink",
} as const;

export function Rail({
  variant = "COLUMNS",
  className,
  children,
}: {
  variant?: keyof typeof railVariants;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", railVariants[variant], className)}>
      {children}
    </div>
  );
}
