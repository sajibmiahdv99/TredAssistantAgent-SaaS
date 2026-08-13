import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  X,
  ArrowRight,
  Zap,
  HelpCircle,
  Mail,
} from "lucide-react";
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
      { title: "Pricing — Hermes" },
      {
        name: "description",
        content:
          "Start free, upgrade to Pro for $49/month, or build a custom Enterprise plan. Every tier includes signal parsing, a risk engine, and encrypted API keys.",
      },
      { property: "og:title", content: "Pricing — Hermes" },
      {
        property: "og:description",
        content:
          "Start free, upgrade to Pro for $49/month, or build a custom Enterprise plan.",
      },
    ],
  }),
  component: Page,
});

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
    name: "Pro",
    price: "$49",
    period: "/month",
    description:
      "Go live with AI-powered parsing, full risk automation, and server-side exits.",
    features: [
      "Live + paper trading",
      "Up to 3 exchange accounts",
      "Unlimited signal channels",
      "AI + regex signal parsing",
      "Full adaptive risk engine",
      "Server-side TP/SL, trailing stops & timeouts",
      "Unlimited backtesting (90 days of klines)",
      "Analytics & symbol heat map",
      "Priority support",
    ],
    cta: "Start free trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description:
      "For teams and institutions that need scale, control, and compliance.",
    features: [
      "Unlimited exchange accounts & channels",
      "Multi-user team workspace with roles",
      "Custom risk rules & audit logs",
      "MT5 / DEX integration",
      "SSO / SAML",
      "Dedicated account manager",
      "Custom SLA",
      "On-premise deployment option",
    ],
    cta: "Contact sales",
    popular: false,
  },
];

type CellValue = string | boolean;

const comparisonRows: { feature: string; free: CellValue; pro: CellValue; enterprise: CellValue }[] = [
  { feature: "Trading mode", free: "Paper only", pro: "Paper + Live", enterprise: "Paper + Live" },
  { feature: "Exchange accounts", free: "1", pro: "Up to 3", enterprise: "Unlimited" },
  { feature: "Signal channels", free: "1", pro: "Unlimited", enterprise: "Unlimited" },
  { feature: "Signal parser", free: "Regex", pro: "AI + Regex", enterprise: "AI + Regex" },
  { feature: "Adaptive risk engine", free: "Basic", pro: "Full", enterprise: "Custom" },
  { feature: "Server-side exits (TP/SL)", free: false, pro: true, enterprise: true },
  { feature: "Backtest history", free: "30 days", pro: "90 days", enterprise: "Custom" },
  { feature: "Analytics & heat map", free: false, pro: true, enterprise: true },
  { feature: "Team workspace", free: false, pro: false, enterprise: true },
  { feature: "Priority support", free: false, pro: true, enterprise: true },
  { feature: "Dedicated account manager", free: false, pro: false, enterprise: true },
  { feature: "On-premise deployment", free: false, pro: false, enterprise: true },
];

const faqTeasers = [
  {
    q: "Can I cancel my Pro subscription anytime?",
    a: "Yes. Cancel from your billing page at any moment — Pro access continues until the end of the paid period, no questions asked.",
  },
  {
    q: "Is there a free trial?",
    a: "Every new account gets a 7-day Premium trial with full Pro features. No credit card required.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Credit and debit cards via Stripe. Enterprise customers can also pay by USDT, wire transfer, or invoice.",
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
            Start with free paper trading. Upgrade to Pro when you're ready to
            go live. Every paid plan includes a 7-day free trial — no credit
            card required.
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 lg:grid-cols-3">
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
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  Most popular
                </Badge>
              )}
              <CardHeader>
                <CardTitle>{tier.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">
                    {tier.price}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {tier.period}
                  </span>
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
                {tier.name === "Enterprise" ? (
                  <Button asChild variant="outline" className="w-full">
                    <a href="mailto:sales@hermesagent.com?subject=Enterprise%20plan%20inquiry">
                      <Mail className="h-4 w-4" /> Contact sales
                    </a>
                  </Button>
                ) : (
                  <Button asChild className="w-full">
                    <Link
                      to="/auth"
                      search={{ mode: "signup" } as never}
                    >
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
          Prices in USD, excluding applicable taxes. Annual billing available —
          save 20% by choosing yearly when you upgrade.
        </p>
      </section>

      {/* Comparison table */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Compare plans
          </h2>
          <p className="mt-3 text-muted-foreground">
            Everything you need to pick the right tier — upgrade or downgrade
            at any time.
          </p>
        </div>
        <div className="mt-8 overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-1/2 bg-card/60">Feature</TableHead>
                <TableHead className="text-center">Free</TableHead>
                <TableHead className="text-center text-primary">Pro</TableHead>
                <TableHead className="text-center">Enterprise</TableHead>
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
                    <Cell value={row.pro} />
                  </TableCell>
                  <TableCell>
                    <Cell value={row.enterprise} />
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
            <h2 className="text-2xl font-semibold tracking-tight">
              Still deciding?
            </h2>
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
