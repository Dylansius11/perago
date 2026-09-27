"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/*
 * The one scroll-scrubbed timeline on the page (docs/DESIGN-SYSTEM.md §5):
 * a hairline pinned under the top bar that fills as the reader moves through
 * one section, so a six-step story reads as one continuous path. It ships
 * full-width, so without JavaScript or with reduced motion it is a static
 * rule rather than an empty track.
 */
export function ScrollRail({ target }: { target: string }) {
  const bar = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        bar.current,
        { scaleX: 0 },
        {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: `#${target}`,
            start: "top 64px",
            end: "bottom 80%",
            scrub: 0.35,
          },
        },
      );
    });
    return () => media.revert();
  });

  return (
    <div aria-hidden className="sticky top-16 z-30 h-0.5 bg-rule/60">
      <div ref={bar} className="h-full origin-left bg-signal" />
    </div>
  );
}
