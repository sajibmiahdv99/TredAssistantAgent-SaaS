import * as React from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "./kbd";

export type CommandItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  kbd?: string;
};

export type CommandGroup = {
  label: string;
  items: CommandItem[];
};

export function isMacPlatform() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iphone|ipad|ipod/i.test(navigator.platform ?? "")
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandGroup[];
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:transition-none motion-reduce:animate-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command loop className="max-h-[min(28rem,80vh)] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                className="flex h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Type a command or search…"
              />
              <Kbd>{isMacPlatform() ? "⌘" : "Ctrl"} K</Kbd>
            </div>
            <Command.List className="max-h-[min(24rem,70vh)] overflow-y-auto p-1">
              <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
                No results found.
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group.label}
                  heading={group.label}
                  className="text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                >
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.id}
                        onSelect={item.onSelect}
                        className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-secondary data-[selected=true]:text-foreground"
                      >
                        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="flex-1">{item.label}</span>
                        {item.kbd && <Kbd>{item.kbd}</Kbd>}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const CmdHotkey = React.memo(function CmdHotkey({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Kbd>{isMacPlatform() ? "⌘" : "Ctrl"}</Kbd>
      <Kbd>K</Kbd>
    </span>
  );
});
