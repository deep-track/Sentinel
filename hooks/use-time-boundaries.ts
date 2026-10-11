"use client";

import { useEffect, useState } from "react";
import { timeBoundaries } from "@/components/sentinel/format";

/**
 * Today / this-month boundaries in the viewer's timezone, refreshed every
 * minute (rounded to the minute so query args stay stable between ticks).
 * Null until mounted, so server and client renders agree.
 */
export function useTimeBoundaries() {
  const [value, setValue] = useState<ReturnType<typeof timeBoundaries> | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      now.setSeconds(0, 0);
      setValue(timeBoundaries(now));
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return value;
}
