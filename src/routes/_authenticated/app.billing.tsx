import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { PageHeader, Card } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getBilling } from "@/lib/user.functions";
import { CryptoPay } from "@/components/CryptoPay";

const opts = queryOptions({ queryKey: ["billing"], queryFn: () => getBilling() });

export const Route = createFileRoute("/_authenticated/app/billing")({
  loader: ({ context }) => context.queryClient.ensureQueryData(opts),
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function Page() {
  const { data } = useSuspenseQuery(opts);
  const sub = data.subscription;
  return (
    <>
      <PageHeader title="Billing" subtitle="Subscription, invoices and available plans." />
      <CryptoPay />
      <Card className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Current subscription
        </p>
        {sub ? (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-xl font-semibold capitalize">{sub.plan_code}</p>
            <p className="text-sm text-muted-foreground">
              {sub.billing_interval} · {sub.status}
            </p>
            {sub.current_period_ends_at && (
              <p className="text-xs text-muted-foreground">
                Renews {new Date(sub.current_period_ends_at).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No active subscription.</p>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Plans
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.plans.map((p) => (
          <Card key={p.code}>
            <p className="text-lg font-semibold">{p.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
            <p className="mt-3 text-2xl font-bold">
              ${Number(p.monthly_price).toFixed(0)}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li>{p.max_open_positions} open positions</li>
              <li>{p.max_daily_trades} trades / day</li>
            </ul>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Invoices
      </h2>
      {data.invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.invoice_number}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {i.issued_at ? new Date(i.issued_at).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    {Number(i.amount).toFixed(2)} {i.currency}
                  </TableCell>
                  <TableCell className="text-xs uppercase">{i.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
