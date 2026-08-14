import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { PageHeader, Card } from "@/components/PageHeader";
import { getOverview, getAnalytics } from "@/lib/user.functions";
import { DashboardCharts } from "@/components/DashboardCharts";
import { Activity, CreditCard, Network, Wallet } from "lucide-react";

const opts = queryOptions({ queryKey: ["overview"], queryFn: () => getOverview() });
const analyticsOpts = queryOptions({ queryKey: ["analytics"], queryFn: () => getAnalytics() });

export const Route = createFileRoute("/_authenticated/app/")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(opts);
    context.queryClient.ensureQueryData(analyticsOpts);
  },
  component: Page,
  errorComponent: ({ error }) => <p className="text-sm text-destructive">{error.message}</p>,
  notFoundComponent: () => <p>Not found.</p>,
});

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Icon className="h-5 w-5 text-primary" />
      </div>
    </Card>
  );
}

function Page() {
  const { data } = useSuspenseQuery(opts);
  const { data: analytics } = useSuspenseQuery(analyticsOpts);
  const sub = data.subscription;
  return (
    <>
      <PageHeader title="Overview" subtitle="Account snapshot, P&L, and connection status." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Network}
          label="Exchanges"
          value={String(data.exchangeCount)}
          hint="Connected accounts"
        />
        <Stat
          icon={Activity}
          label="Active trades"
          value={String(data.activeTradesCount)}
          hint={`Open P&L ${data.openPnl.toFixed(2)}`}
        />
        <Stat
          icon={Wallet}
          label="Balance"
          value={`$${Number(data.balance?.available_balance ?? 0).toLocaleString()}`}
          hint="Available"
        />
        <Stat
          icon={CreditCard}
          label="Plan"
          value={sub?.plan_code ?? "Free"}
          hint={sub?.status ?? "No subscription"}
        />
      </div>
      {analytics.balanceSeries.length > 0 && (
        <DashboardCharts
          balanceSeries={analytics.balanceSeries}
          pnlDistribution={analytics.pnlDistribution}
          wins={analytics.wins}
          losses={analytics.losses}
          winRate={analytics.winRate}
        />
      )}
    </>
  );
}
