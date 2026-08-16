import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  adminListTelegramAccounts,
  adminListSignalChannels,
  adminToggleChannelSignalSource,
} from "@/lib/admin.functions";

const accountsOpts = queryOptions({
  queryKey: ["admin", "telegram-accounts"],
  queryFn: () => adminListTelegramAccounts(),
});
const channelsOpts = queryOptions({
  queryKey: ["admin", "signal-channels"],
  queryFn: () => adminListSignalChannels(),
});

export const Route = createFileRoute("/_authenticated/admin/telegram")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsOpts),
      context.queryClient.ensureQueryData(channelsOpts),
    ]),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400",
    pending: "bg-amber-500/15 text-amber-400",
    disconnected: "bg-muted text-muted-foreground",
    error: "bg-red-500/15 text-red-400",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function Page() {
  const qc = useQueryClient();
  const { data: accounts } = useSuspenseQuery(accountsOpts);
  const { data: channels } = useSuspenseQuery(channelsOpts);

  const toggleFn = useServerFn(adminToggleChannelSignalSource);
  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; is_signal_source: boolean }) => toggleFn({ data: vars }),
    onSuccess: () => {
      toast.success("Channel updated.");
      qc.invalidateQueries({ queryKey: ["admin", "signal-channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [filter, setFilter] = useState<"all" | "enabled">("all");
  const visible = channels.filter((c) => (filter === "enabled" ? c.is_signal_source : true));

  const enabledCount = channels.filter((c) => c.is_signal_source).length;
  const activeAccounts = accounts.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title="Telegram"
        subtitle={`${accounts.length} accounts · ${enabledCount}/${channels.length} signal channels`}
      />

      <div className="space-y-6">
        {/* Accounts */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            Connected Telegram Accounts
          </h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Linked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No Telegram accounts connected yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.label}</TableCell>
                      <TableCell>{a.owner_email ?? a.user_id.slice(0, 8)}</TableCell>
                      <TableCell>{a.masked_phone ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={statusBadge(a.status)}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Channels */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              Signal Channels ({enabledCount} enabled)
            </h3>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={filter === "all" ? "default" : "outline"}
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={filter === "enabled" ? "default" : "outline"}
                onClick={() => setFilter("enabled")}
              >
                Enabled
              </Button>
            </div>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Chat ID</TableHead>
                  <TableHead className="text-right">Signals</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead>Signal Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {activeAccounts === 0
                        ? "Connect a Telegram account first (Sources page), then sync channels."
                        : "No channels synced yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        {c.username ? (
                          <div className="text-xs text-muted-foreground">@{c.username}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{c.owner_email ?? c.user_id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">{c.tg_chat_id ?? "—"}</TableCell>
                      <TableCell className="text-right">{c.signals_count}</TableCell>
                      <TableCell className="text-right">
                        {c.win_rate != null ? `${c.win_rate}%` : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={c.is_signal_source ? "default" : "outline"}
                          disabled={toggleMut.isPending}
                          onClick={() =>
                            toggleMut.mutate({
                              id: c.id,
                              is_signal_source: !c.is_signal_source,
                            })
                          }
                        >
                          {c.is_signal_source ? "✓ Source" : "Enable"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}
