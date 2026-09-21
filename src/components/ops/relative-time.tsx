import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * Relative time in mono with the absolute timestamp on hover.
 * Re-renders on a fixed cadence (default 30s) so it stays fresh without a ticker.
 */
export function RelativeTime({
  date,
  className,
  title,
}: {
  date: Date | string | number;
  className?: string;
  title?: string;
}) {
  const value = useMemo(() => new Date(date), [date]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rel = useMemo(
    () => formatDistanceToNowStrict(value, { addSuffix: true }),
    [now, value],
  );
  const abs = useMemo(() => format(value, "MMM d, yyyy HH:mm:ss"), [value]);

  return (
    <time
      dateTime={value.toISOString()}
      title={title ?? abs}
      className={cn("font-mono tabular text-xs text-muted-foreground", className)}
    >
      {rel}
    </time>
  );
}
