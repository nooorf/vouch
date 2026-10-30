"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Re-render the page every few seconds while something is happening in the background.
 * - Waits for each refresh to finish before scheduling the next: on a slow connection a refresh can
 *   take longer than the interval, and starting a new one would cancel it, so the page never updated.
 * - `from` (ISO time): stay idle until then, e.g. until shortly before a review window closes.
 */
export function AutoRefresh({ seconds = 3, from }: { seconds?: number; from?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [active, setActive] = useState(!from);

  useEffect(() => {
    if (active || !from) return;
    const wait = new Date(from).getTime() - Date.now();
    const t = setTimeout(() => setActive(true), Math.max(0, Math.min(wait, 2_147_000_000)));
    return () => clearTimeout(t);
  }, [active, from]);

  useEffect(() => {
    if (!active || refreshing) return;
    const t = setTimeout(() => startRefresh(() => router.refresh()), seconds * 1000);
    return () => clearTimeout(t);
  }, [active, refreshing, router, seconds]);
  return null;
}
