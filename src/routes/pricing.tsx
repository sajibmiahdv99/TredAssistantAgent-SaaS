import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X, ArrowRight, Zap, HelpCircle, Mail } from "lucide-react";
import { PublicNav, PublicFooter } from "@/components/PublicNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — AI TRED AGENT" },
      {
        name: "description",
        content:
          "Start free with paper trading, then upgrade to Starter $29/month, Premium $79/month, or a custom Professional plan. Every tier includes signal parsing, a risk engine, and encrypted API keys.",
      },
      { property: "og:title", content: "Pricing — AI TRED AGENT" },
      {
        property: "og:description",
        content:
          "Start free, upgrade to Starter $29/month, Premium $79/month, or a custom Professional plan.",
      },
    ],
  }),
  component: Page,
});

// Plan set mirrors src/lib/billing.functions.ts → getPricingPlans (single source).
const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Explore signal trading in a fully risk-free environment.",
    features: [
      "Paper trading mode",
      "1 exchange account",
      "1 signal channel",
      "Regex-based signal parser",
      "Basic risk rules",
      "30 days of backtest data",
      "Community support",
    ],
    cta: "Start free",
    popular: false,
  },
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    description: "Get started with automated trading signals.",
    features: [
      "Live + paper trading",
      "Up to 3 exchange accounts",
      "Up to 20 trades / day",
      "3 open positions",
      "10% max trade size",
      "Basic signals",
    ],
    cta: "Get started",
    popular: false,
  },
  {
    name: "Premium",
    price: "$79",
    period: "/month",
    description: "For active traders who need more capacity.",
    features: [
      "Live + paper trading",
      "Up to 10 exchange accounts",
      "Up to 50 trades / day",
      "10 open positions",
      "25% max trade size",
      "Premium signals",
      "Priority support",
    ],
    cta: "Get started",
    popular: true,
  },
  {
    name: "Professional",
    price: "$199",
    period: "/month",
    description: "Maximum performance and unlimited capacity.",
    features: [
      "Unlimited trades & exchange accounts",
      "50 open positions",
      "50% max trade size",
      "All signals & sources",
      "Dedicated support",
      "Custom risk rules & audit logs",
    ],
    cta: "Contact sales",
    popular: false,
  },
];

type CellValue = string | boolean;

const comparisonRows: {
  feature: string;
  free: CellValue;
  starter: CellValue;
  premium: CellValue;
  professional: CellValue;
}[] = [
  {
    feature: "Trading mode",
    free: "Paper only",
    starter: "Paper + Live",
    premium: "Paper + Live",
    professional: "Paper + Live",
  },
  {
    feature: "Exchange accounts",
    free: "1",
    starter: "Up to 3",
    premium: "Up to 10",
    professional: "Unlimited",
  },
  {
    feature: "Trades / day",
    free: "—",
    starter: "Up to 20",
    premium: "Up to 50",
    professional: "Unlimited",
  },
  {
    feature: "Open positions",
    free: "—",
    starter: "3",
    premium: "10",
    professional: "50",
  },
  {
    feature: "Max trade size",
    free: "—",
    starter: "10%",
    premium: "25%",
    professional: "50%",
  },
  {
    feature: "Signal parser",
    free: "Regex",
    starter: "Regex",
    premium: "AI + Regex",
    professional: "AI + Regex",
  },
  {
    feature: "Adaptive risk engine",
    free: "Basic",
    starter: "Full",
    premium: "Full",
    professional: "Custom",
  },
  {
    feature: "Server-side exits (TP/SL)",
    free: false,
    starter: true,
    premium: true,
    professional: true,
  },
  {
    feature: "Backtest history",
    free: "30 days",
    starter: "30 days",
    premium: "90 days",
    professional: "Unlimited",
  },
  {
    feature: "Analytics & heat map",
    free: false,
    starter: false,
    premium: true,
    professional: true,
  },
  {
    feature: "Team workspace",
    free: false,
    starter: false,
    premium: false,
    professional: true,
  },
  {
    feature: "Priority support",
    free: false,
    starter: false,
    premium: true,
    professional: true,
  },
  {
    feature: "Dedicated account manager",
    free: false,
    starter: false,
    premium: false,
    professional: true,
  },
  {
    feature: "On-premise deployment",
    free: false,
    starter: false,
    premium: false,
    professional: true,
  },
];

const faqTeasers = [
  {
    q: "Can I cancel my paid plan anytime?",
    a: "Yes. Cancel from your billing page at any moment — paid access continues until the end of the current period, no questions asked.",
  },
  {
    q: "Do I need a credit card to start?",
    a: "No. Start with free paper trading with no card required. Upgrade only when you're ready to trade live.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Crypto (USDT on TRC-20) paid to our Trust Wallet, bank transfer, or wire. We'll send you an address and verify your deposit on-chain.",
  },
];

function Cell({ value }: { value: CellValue }) {
  if (value === true) {
    return <Check className="mx-auto h-4 w-4 text-primary" />;
  }
  if (value === false) {
    return <X className="mx-auto h-4 w-4 text-muted-foreground/40" />;
  }
  return <span className="text-sm text-foreground/90">{value}</span>;
}

function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="mx-auto max-w-4xl px-6 pt-20 pb-14 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" /> Simple, transparent pricing
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
            Pay for automation, <span className="text-primary">not for hype</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            Start with free paper trading — no credit card needed. Upgrade to Starter, Premium, or
            Professional when you're ready to go live. Pay with USDT (TRC-20) to our Trust Wallet,
            bank transfer, or invoice.
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.name}
              className={
                tier.popular
                  ? "relative border-primary/50 shadow-[0_0_40px_-12px_hsl(var(--primary)/0.35)]"
                  : ""
              }
            >
              {tier.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
              )}
              <CardHeader>
                <CardTitle>{tier.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.period}</span>
                </div>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-foreground/90">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {tier.name === "Professional" ? (
                  <Button asChild variant="outline" className="w-full">
                    <a href="mailto:sales@aitredagent.com?subject=Professional%20plan%20inquiry">
                      <Mail className="h-4 w-4" /> Contact sales
                    </a>
                  </Button>
                ) : (
                  <Button asChild className="w-full">
                    <Link to="/auth" search={{ mode: "signup" } as never}>
                      {tier.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prices in USD, excluding applicable taxes. Annual billing available — save 20% by choosing
          yearly when you upgrade.
        </p>
      </section>

      {/* Comparison table */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Compare plans</h2>
          <p className="mt-3 text-muted-foreground">
            Everything you need to pick the right tier — upgrade or downgrade at any time.
          </p>
        </div>
        <div className="mt-8 overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-1/2 bg-card/60">Feature</TableHead>
                <TableHead className="text-center">Free</TableHead>
                <TableHead className="text-center">Starter</TableHead>
                <TableHead className="text-center text-primary">Premium</TableHead>
                <TableHead className="text-center">Professional</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonRows.map((row) => (
                <TableRow key={row.feature}>
                  <TableCell className="font-medium">{row.feature}</TableCell>
                  <TableCell>
                    <Cell value={row.free} />
                  </TableCell>
                  <TableCell>
                    <Cell value={row.starter} />
                  </TableCell>
                  <TableCell>
                    <Cell value={row.premium} />
                  </TableCell>
                  <TableCell>
                    <Cell value={row.professional} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* FAQ teaser */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="flex items-center gap-3">
            <HelpCircle className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight">Still deciding?</h2>
          </div>
          <div className="mt-6 space-y-6">
            {faqTeasers.map((item) => (
              <div key={item.q}>
                <h3 className="font-medium">{item.q}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link to="/faq">
                Read the full FAQ <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
