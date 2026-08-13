import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Link2,
  Users,
  Wallet,
  ArrowRight,
  Gift,
  RefreshCw,
  BadgeCheck,
  Clock,
} from "lucide-react";
import { PublicNav, PublicFooter } from "@/components/PublicNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/affiliate")({
  head: () => ({
    meta: [
      { title: "Affiliate Program — Hermes" },
      {
        name: "description",
        content:
          "Earn 30% / 10% / 5% recurring multi-level commissions by referring traders to Hermes. Monthly payouts in USDT or bank transfer. Join free.",
      },
      { property: "og:title", content: "Affiliate Program — Hermes" },
      {
        property: "og:description",
        content:
          "Earn 30% / 10% / 5% recurring multi-level commissions by referring traders to Hermes.",
      },
    ],
  }),
  component: Page,
});

const tiers = [
  {
    level: "Level 1",
    rate: "30%",
    desc: "Commission on every subscription paid by traders you refer directly.",
    icon: Link2,
    highlight: true,
  },
  {
    level: "Level 2",
    rate: "10%",
    desc: "Commission on subscriptions from people your referrals bring in.",
    icon: Users,
    highlight: false,
  },
  {
    level: "Level 3",
    rate: "5%",
    desc: "Commission on a third level of referrals — your network keeps growing.",
    icon: Gift,
    highlight: false,
  },
];

const steps = [
  {
    n: "01",
    t: "Join the program",
    d: "Sign up for a free Hermes account and activate your affiliate dashboard. No minimum volume, no approval process.",
  },
  {
    n: "02",
    t: "Share your unique link",
    d: "Grab your personal referral link or QR code from the referrals page and share it with your audience — Telegram groups, YouTube, X, or your blog.",
  },
  {
    n: "03",
    t: "Earn recurring commissions",
    d: "When a referred trader subscribes to Pro or Enterprise, you earn 30% of their subscription every month they stay subscribed.",
  },
  {
    n: "04",
    t: "Get paid monthly",
    d: "Earnings are calculated at the end of each month and paid out within 15 days — in USDT or via bank transfer.",
  },
];

const benefits = [
  {
    icon: RefreshCw,
    t: "Recurring, not one-off",
    d: "Unlike one-time referral bonuses, you earn 30% of every monthly renewal. A 10-customer network at $49/mo pays you ~$147 every single month.",
  },
  {
    icon: BadgeCheck,
    t: "Real-time tracking",
    d: "Your dashboard shows clicks, signups, conversions, and lifetime earnings in real time. Attribution is cookie-based with a 90-day window.",
  },
  {
    icon: Wallet,
    t: "Flexible payouts",
    d: "Get paid in USDT (TRC-20 or ERC-20) or via bank transfer. The minimum payout threshold is just $50.",
  },
  {
    icon: Clock,
    t: "Lifetime cookie window",
    d: "Once someone clicks your link, they're attributed to you for 90 days. If they come back later and subscribe, it still counts.",
  },
];

function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="mx-auto max-w-4xl px-6 pt-20 pb-14 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Gift className="h-3 w-3" /> Earn 30% recurring commissions
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
            Turn your audience into <span className="text-primary">monthly income</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            Every trader needs risk management. Share Hermes with your audience
            and earn 30% / 10% / 5% recurring commissions across three levels —
            paid monthly, for as long as your referrals stay subscribed.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" } as never}>
                Join the program <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/referrals">View affiliate dashboard</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free to join. No minimums. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Commission tiers */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Three levels of commissions
          </h2>
          <p className="mt-3 text-muted-foreground">
            Earn on direct referrals and on the referrals your network brings in
            — up to three levels deep.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {tiers.map((tier) => {
            const Icon = tier.icon;
            return (
              <div
                key={tier.level}
                className={
                  tier.highlight
                    ? "relative rounded-2xl border border-primary/50 bg-card p-8 text-center shadow-[0_0_40px_-12px_hsl(var(--primary)/0.35)]"
                    : "rounded-2xl border border-border bg-card p-8 text-center"
                }
              >
                {tier.highlight && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Your direct referrals
                  </Badge>
                )}
                <Icon className="mx-auto h-6 w-6 text-primary" />
                <div className="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {tier.level}
                </div>
                <div className="mt-2 text-5xl font-semibold tracking-tight text-primary">
                  {tier.rate}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{tier.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-3 text-muted-foreground">
            From sign-up to your first payout in four simple steps.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.n}
              className="rounded-2xl border border-border bg-card p-8"
            >
              <div className="text-xs font-semibold tracking-widest text-primary">
                STEP {step.n}
              </div>
              <h3 className="mt-3 text-lg font-semibold">{step.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Why affiliates love Hermes
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.t}
                className="rounded-xl border border-border bg-card p-6 transition hover:border-primary/40"
              >
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold">{b.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{b.d}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Payout details */}
      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="flex items-center gap-3">
            <Wallet className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight">
              Payout details
            </h2>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Schedule
              </h3>
              <p className="mt-2 text-sm text-foreground/90">
                Commissions accrue daily and are settled at the end of each
                calendar month. Payouts are processed within 15 days.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Methods
              </h3>
              <p className="mt-2 text-sm text-foreground/90">
                USDT (TRC-20 or ERC-20) or bank transfer (SWIFT / SEPA). You
                choose your preferred method in the affiliate dashboard.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Minimum payout
              </h3>
              <p className="mt-2 text-sm text-foreground/90">
                $50. Balances below the threshold roll over to the next month
                automatically.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Attribution window
              </h3>
              <p className="mt-2 text-sm text-foreground/90">
                90-day cookie-based attribution. If a click later converts to a
                subscription, you still earn the commission.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-2xl border border-primary/30 bg-card p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Start earning on your network today.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Join free, grab your link, and start building recurring income.
            It takes less than a minute to get started.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" } as never}>
                Join the program <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/referrals">Go to referrals dashboard</Link>
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}