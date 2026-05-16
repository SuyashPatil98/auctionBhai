"use client";

import { useEffect, useState } from "react";

/**
 * Renders a fixture kickoff time in the user's local timezone.
 *
 * Why this is a client component: server-side toLocaleString uses the
 * server's timezone (Vercel BOM1 = IST) for every viewer regardless of where
 * they actually are. Rendering on the client uses the browser's actual tz,
 * or the IANA tz the user pinned on /account.
 *
 * To avoid hydration mismatches, we render an ISO placeholder on first
 * render and swap in the formatted string after hydration. The placeholder
 * keeps roughly the same width so the layout doesn't reflow.
 */

export type KickoffProps = {
  /** ISO 8601 string, or a Date (will be coerced). */
  at: string | Date;
  /**
   * Optional IANA timezone (e.g. "Europe/London"). If null/undefined or
   * empty string, the browser's detected timezone is used.
   */
  tz?: string | null;
  /**
   * "datetime"  → "Tue 11 Jun · 21:30"  (default)
   * "date"      → "Tue 11 Jun"
   * "time"      → "21:30"
   * "full"      → "Tue 11 Jun 2026 · 21:30 IST"
   */
  variant?: "datetime" | "date" | "time" | "full";
  /** Tailwind classes. */
  className?: string;
};

export function Kickoff({
  at,
  tz,
  variant = "datetime",
  className,
}: KickoffProps) {
  const [text, setText] = useState<string>(() => placeholder(variant));

  useEffect(() => {
    const d = typeof at === "string" ? new Date(at) : at;
    setText(format(d, variant, tz || undefined));
  }, [at, tz, variant]);

  return <span className={className}>{text}</span>;
}

function placeholder(variant: KickoffProps["variant"]): string {
  switch (variant) {
    case "date":
      return "—— ——";
    case "time":
      return "——:——";
    case "full":
      return "—— —— ———— · ——:—— ———";
    default:
      return "—— —— · ——:——";
  }
}

/**
 * Pure formatter — exported so tests + server code can reuse the same
 * formatting shape if needed. Always renders in the supplied tz (or browser
 * default if undefined).
 */
export function format(
  d: Date,
  variant: KickoffProps["variant"] = "datetime",
  tz?: string
): string {
  const base: Intl.DateTimeFormatOptions = {
    timeZone: tz, // undefined → browser default
    hour12: false,
  };

  if (variant === "date") {
    return new Intl.DateTimeFormat(undefined, {
      ...base,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(d);
  }

  if (variant === "time") {
    return new Intl.DateTimeFormat(undefined, {
      ...base,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  if (variant === "full") {
    return new Intl.DateTimeFormat(undefined, {
      ...base,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  }

  // datetime
  return new Intl.DateTimeFormat(undefined, {
    ...base,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
