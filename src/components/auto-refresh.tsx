"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * Re-render the page every few seconds while something is happening in the background.
 * Waits for each refresh to finish before scheduling the next: on a slow connection a refresh can
 * take longer than the interval, and starting a new one would cancel it, so the page never updated.
 */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (refreshing) return;
    const t = setTimeout(() => startRefresh(() => router.refresh()), seconds * 1000);
    return () => clearTimeout(t);
  }, [refreshing, router, seconds]);
  return null;
}
