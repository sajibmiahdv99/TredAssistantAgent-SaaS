import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminListSubscriptions, adminGrantSubscription } from "@/lib/admin.functions";

const opts = queryOptions({
  queryKey: ["admin", "subscriptions"],
  queryFn: () => adminListSubscriptions(),
});

export const Route = createFileRoute("/_authenticated/admin/subscriptions")({
  loader: ({ context }) => context.queryClient.ensureQueryData(opts),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function GrantDialog({ subscriptionId }: { subscriptionId: string }) {
  const qc = useQueryClient();
  const grantFn = useServerFn(adminGrantSubscription);
  const [planCode, setPlanCode] = useState("premium");
  const [months, setMonths] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      grantFn({
        data: {
          subscriptionId,
          planCode,
          billingInterval: "monthly",
          months: Math.max(1, parseInt(months) || 1),
        },
      }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Grant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Grant manual access</DialogTitle>
          <DialogDescription>
            Activate this subscription manually (e.g. payment verified off-platform).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Plan</label>
            <Select value={planCode} onValueChange={setPlanCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Months</label>
            <Input
              type="number"
              min={1}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={() => grant.mutate()} disabled={grant.isPending}>
            {grant.isPending ? "Activating…" : "Activate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Page() {
  const { data } = useSuspenseQuery(opts);
  return (
    <>
      <PageHeader title="Subscriptions" subtitle={`${data.length} total`} />
      {data.length === 0 ? (
        <EmptyState title="No subscriptions" description="No customers have subscribed yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Renews</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.user_id.slice(0, 8)}…</TableCell>
                  <TableCell>{s.plan_code}</TableCell>
                  <TableCell>{s.billing_interval}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "active" ? "default" : "outline"}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.current_period_ends_at
                      ? new Date(s.current_period_ends_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <GrantDialog subscriptionId={s.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
