import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/PageHeader";

type Point = { t: string; balance: number; pnl: number };
type Dist = { symbol: string; pnl: number; trades: number };

export function DashboardCharts({
  balanceSeries,
  pnlDistribution,
  wins,
  losses,
  winRate,
}: {
  balanceSeries: Point[];
  pnlDistribution: Dist[];
  wins: number;
  losses: number;
  winRate: number;
}) {
  const winData = [
    { name: "Wins", value: wins, color: "hsl(var(--primary))" },
    { name: "Losses", value: losses, color: "hsl(0 84% 60%)" },
  ];
  const seriesForChart = balanceSeries.map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Balance over time</h3>
          <span className="text-xs text-muted-foreground">Closed trades, cumulative</span>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <AreaChart data={seriesForChart} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`$${Number(v).toLocaleString()}`, "Balance"]}
              />
              <Area type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#balFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Win rate</h3>
          <span className="text-xs text-muted-foreground">{winRate.toFixed(1)}%</span>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={winData}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                stroke="hsl(var(--background))"
              >
                {winData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary" /> Wins {wins}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Losses {losses}</span>
        </div>
      </Card>

      <Card className="lg:col-span-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">PnL distribution by symbol</h3>
          <span className="text-xs text-muted-foreground">Net per market</span>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={pnlDistribution} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <XAxis dataKey="symbol" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`$${Number(v).toLocaleString()}`, "PnL"]}
              />
              <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                {pnlDistribution.map((d) => (
                  <Cell key={d.symbol} fill={d.pnl >= 0 ? "hsl(var(--primary))" : "hsl(0 84% 60%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
