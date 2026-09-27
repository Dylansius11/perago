"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/*
 * Shared entrance vocabulary. Every section-level reveal on the page uses
 * one of these two primitives so motion stays consistent and honors
 * prefers-reduced-motion.
 *
 * Both carry `data-reveal`: the entrance state ships inline in the server
 * HTML, and the layout's noscript rule resets those properties so the page
 * stays readable when JavaScript never runs.
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
  return (
    <motion.div
      className={className}
      data-reveal
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
  return (
    <motion.div
      className={className}
      data-reveal
      initial={{ clipPath: "inset(0 0 100% 0)", y: 14 }}
      whileInView={{ clipPath: "inset(0 0 0% 0)", y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.85, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
