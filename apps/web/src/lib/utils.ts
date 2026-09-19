import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class merger every shadcn component imports from `@/lib/utils`. Later
 * classes win, so a caller's layout class can override a variant's default.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
