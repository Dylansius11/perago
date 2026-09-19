"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/*
 * Shared entrance vocabulary. Every section-level reveal on the page uses
 * one of these two primitives so motion stays consistent, honors
 * prefers-reduced-motion, and never leaves content invisible when JS fails:
 * the blurred state is a CSS default, so the element is still readable
 * before hydration flips it on.
 */

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export function RiseIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ y: 26, opacity: 0, filter: "blur(6px)" }}
      whileInView={{ y: 0, opacity: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.75, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

export function Unveil({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ clipPath: "inset(0 0 100% 0)", y: 14 }}
      whileInView={{ clipPath: "inset(0 0 0% 0)", y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.85, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
