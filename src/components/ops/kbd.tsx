import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keyboard-key affordance (Superhuman pattern: show the hint next to actions). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center gap-0.5 rounded border border-border bg-secondary px-1.5 font-mono text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {Children.map(children, (child, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="opacity-50">+</span>}
          {child}
        </span>
      ))}
    </kbd>
  );
}
