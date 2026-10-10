"use client";

import { format as formatDate, formatDistanceToNow } from "date-fns";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True only after hydration, so locale/timezone-dependent text never mismatches the server HTML. */
export function useHasMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

type ClientDateProps = {
  value: string | number | Date | null | undefined;
  /** date-fns format string, or "relative" for "3 minutes ago". */
  format?: string;
  fallback?: string;
  className?: string;
};

/**
 * Renders a date in the viewer's timezone/locale after mount. The server (and
 * the first client render) output a stable placeholder, which avoids React
 * hydration mismatches between server and browser timezones.
 */
export function ClientDate({ value, format = "MMM d, yyyy", fallback = "—", className }: ClientDateProps) {
  const mounted = useHasMounted();
  if (value === null || value === undefined || value === "") {
    return <span className={className}>{fallback}</span>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={className}>{fallback}</span>;

  const text = !mounted
    ? "…"
    : format === "relative"
      ? formatDistanceToNow(date, { addSuffix: true })
      : formatDate(date, format);

  return (
    <time dateTime={date.toISOString()} className={className}>
      {text}
    </time>
  );
}
