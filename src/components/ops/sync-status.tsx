import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { RelativeTime } from "./relative-time";

export type SyncState = "live" | "syncing" | "stale" | "error";

const STATE: Record<
  SyncState,
  { dot: string; text: string; label: string; description: string }
> = {
  live: { dot: "bg-success", text: "text-success", label: "Live", description: "Synced" },
  syncing: { dot: "bg-running animate-pulse", text: "text-running", label: "Syncing", description: "Syncing…" },
  stale: { dot: "bg-warning", text: "text-warning", label: "Stale", description: "Last sync" },
  error: { dot: "bg-danger", text: "text-danger", label: "Error", description: "Sync failed" },
};

/** Global sync-status chip (SCREEN 7): dot + label + "as of" clock + hover popover. */
export function SyncStatus({
  state = "live",
  lastSynced,
  asOf,
  className,
}: {
  state?: SyncState;
  lastSynced?: Date | string | number;
  asOf?: Date | string | number;
  className?: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const cfg = STATE[state];

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const asOfValue = asOf ?? now;
  const lastSyncedValue = lastSynced ?? now;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          data-state={state}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium tabular hover:bg-secondary/70",
            cfg.text,
            className,
          )}
        >
          <span className={cn("inline-flex h-1.5 w-1.5 rounded-full", cfg.dot)} />
          <span className="text-foreground">{cfg.label}</span>
          <span className="hidden text-muted-foreground sm:inline">as of</span>
          <span className="hidden font-mono text-muted-foreground sm:inline">
            {new Date(asOfValue).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          className="z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className={cn("inline-flex h-2 w-2 rounded-full", cfg.dot)} />
            {cfg.description}
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last sync</dt>
              <dd className="font-mono tabular text-foreground">
                {new Date(lastSyncedValue).toLocaleTimeString("en-US", { hour12: false })}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Channel</dt>
              <dd className="font-mono tabular text-foreground">Telegram</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium text-foreground">{cfg.label}</dd>
            </div>
          </dl>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sync now
            </button>
            <button className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-secondary">
              Settings
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function RelativeTimeMuted({
  date,
  className,
}: {
  date: Date | string | number;
  className?: string;
}) {
  return <RelativeTime date={date} className={cn("text-[11px]", className)} />;
}
