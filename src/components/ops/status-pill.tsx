import { cn } from "@/lib/utils";
import {
  Activity,
  Check,
  Circle,
  CircleSlash,
  LoaderCircle,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Status semantics are redundantly encoded: icon + label + color (never color alone),
 * using a blue/amber/red/green + "running" pulse token set (Wong/Okabe-Ito CVD-safe).
 */
export type OpsStatus =
  | "running"
  | "queued"
  | "success"
  | "failed"
  | "retrying"
  | "cancelled"
  | "neutral";

type PillConfig = {
  icon: LucideIcon;
  label: string;
  className: string;
  pulse?: boolean;
  strike?: boolean;
};

const CONFIG: Record<OpsStatus, PillConfig> = {
  running: {
    icon: Activity,
    label: "Running",
    className: "bg-running/15 text-running",
    pulse: true,
  },
  queued: {
    icon: LoaderCircle,
    label: "Queued",
    className: "bg-secondary text-muted-foreground",
  },
  success: {
    icon: Check,
    label: "Succeeded",
    className: "bg-success/15 text-success",
  },
  failed: {
    icon: X,
    label: "Failed",
    className: "bg-danger/15 text-danger",
  },
  retrying: {
    icon: RotateCw,
    label: "Retrying",
    className: "bg-warning/15 text-warning",
  },
  cancelled: {
    icon: CircleSlash,
    label: "Cancelled",
    className: "bg-secondary text-muted-foreground",
    strike: true,
  },
  neutral: {
    icon: Circle,
    label: "—",
    className: "bg-secondary text-muted-foreground",
  },
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: OpsStatus;
  label?: string;
  className?: string;
}) {
  const cfg = CONFIG[status] ?? CONFIG.neutral;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight tabular",
        cfg.className,
        className,
      )}
    >
      {cfg.pulse ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
      )}
      <span className={cfg.strike ? "line-through opacity-80" : undefined}>
        {label ?? cfg.label}
      </span>
    </span>
  );
}
