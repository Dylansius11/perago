import { cn } from "@/lib/utils";

/*
 * The Perago mark, drawn in code: one vertical stroke and two diagonals
 * crossing as a six-point asterisk, over a ring broken into five arcs.
 * Geometry is traced from brand/icon-mark.png on a 460 x 504 box centred on
 * the crossing: strokes are 42 wide and 504 long with square ends, the ring
 * runs from radius 125 to 167, and each arc ends either under a stroke or one
 * stroke-width-and-a-half away from it, cut parallel to that stroke.
 *
 * One path, `currentColor`, no ids, so any number of instances can share a
 * page. The same path is inlined in app/icon.svg; change both together.
 */

const PATH =
  "M21 -252L21 252L-21 252L-21 -252Z" +
  "M-207.7 -144.2L228.7 107.8L207.7 144.2L-228.7 -107.8Z" +
  "M-228.7 107.8L207.7 -144.2L228.7 -107.8L-207.7 144.2Z" +
  "M-144.6 -83.5A167 167 0 0 1 0 -167L0 -125A125 125 0 0 0 -108.3 -62.5Z" +
  "M47.5 -160.1A167 167 0 0 1 144.6 -83.5L108.3 -62.5A125 125 0 0 0 47.5 -115.6Z" +
  "M162.4 -38.9A167 167 0 0 1 144.6 83.5L108.3 62.5A125 125 0 0 0 123.9 -16.7Z" +
  "M114.9 121.2A167 167 0 0 1 -114.9 121.2L-76.4 98.9A125 125 0 0 0 76.4 98.9Z" +
  "M-144.6 83.5A167 167 0 0 1 -162.4 -38.9L-123.9 -16.7A125 125 0 0 0 -108.3 62.5Z";

/** Decorative by default: the enclosing link or heading carries the name. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-230 -252 460 504"
      aria-hidden
      focusable="false"
      fill="currentColor"
      className={cn("block shrink-0 text-signal", className)}
    >
      <path d={PATH} />
    </svg>
  );
}
