import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One labelled fact that stacks on narrow screens. The shared `Fact` keeps its
 * label column at every width, which squeezes a long hash or sentence on a
 * phone; these rows give the value the full line instead.
 */
export function Evidence({
  label,
  value,
  note,
  dark = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-5 gap-y-1 border-b py-3 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-baseline",
        dark ? "border-ruleinvert" : "border-rule",
      )}
    >
      <dt
        className={cn(
          "font-mono text-[12px]",
          dark ? "text-paper/50" : "text-fog",
        )}
      >
        {label}
      </dt>
      <dd className="min-w-0">
        <div
          className={cn(
            "break-words font-mono text-[13px]",
            dark ? "text-paper/90" : "text-ink",
          )}
        >
          {value}
        </div>
        {note ? (
          <div
            className={cn(
              "mt-1 [overflow-wrap:anywhere] text-[13px] leading-snug",
              dark ? "text-paper/55" : "text-fog",
            )}
          >
            {note}
          </div>
        ) : null}
      </dd>
    </div>
  );
}
