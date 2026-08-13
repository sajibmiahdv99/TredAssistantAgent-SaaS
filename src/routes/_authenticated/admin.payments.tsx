import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { adminListPayments } from "@/lib/admin.functions";

const opts = queryOptions({ queryKey: ["admin", "payments"], queryFn: () => adminListPayments() });

export const Route = createFileRoute("/_authenticated/admin/payments")({
  loader: ({ context }) => context.queryClient.ensureQueryData(opts),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function Page() {
  const { data } = useSuspenseQuery(opts);
  return (
    <>
      <PageHeader title="Payments" subtitle={`${data.length} records`} />
      {data.length === 0 ? <EmptyState title="No payments" description="Payments will appear once a customer pays." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{p.user_id.slice(0, 8)}…</TableCell>
                  <TableCell>{p.provider}</TableCell>
                  <TableCell>{Number(p.amount).toFixed(2)} {p.currency ?? ""}</TableCell>
                  <TableCell><Badge variant={p.status === "paid" ? "default" : "outline"}>{p.status}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{p.external_payment_ref ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
