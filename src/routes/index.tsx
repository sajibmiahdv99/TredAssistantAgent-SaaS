import { createFileRoute, Link } from "@tanstack/react-router";
import {
  TrendingUp,
  ShieldCheck,
  Radio,
  Zap,
  Network,
  Activity,
  FlaskConical,
  BarChart3,
  Users,
  Clock,
  ArrowRight,
  Star,
} from "lucide-react";
import { PublicNav, PublicFooter } from "@/components/PublicNav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hermes — Automated Crypto Signal Trading Workstation" },
      {
        name: "description",
        content:
          "Hermes auto-trades Telegram signals across Binance, Bybit, OKX and more — with adaptive risk engine, real-time monitoring, and full backtesting. Start free.",
      },
      { property: "og:title", content: "Hermes — Automated Crypto Signal Trading" },
      {
        property: "og:description",
        content: "Auto-trade Telegram signals across your exchanges with built-in risk controls.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

const stats = [
  { v: "5 exchanges +", l: "MT5 / DEX ready" },
  { v: "AI + regex", l: "signal parsing" },
  { v: "Paper & live", l: "execution modes" },
  { v: "Encrypted", l: "API keys at rest" },
];

const features = [
  {
    i: Radio,
    t: "Signal Intelligence",
    d: "Hybrid rules-plus-AI parser extracts symbol, side, entry, SL, and TP1/2/3 from any channel.",
  },
  {
    i: Network,
    t: "Multi-Exchange",
    d: "Binance and Bybit today, OKX/KuCoin/MEXC rolling out. Unified adapter architecture.",
  },
  {
    i: ShieldCheck,
    t: "Adaptive Risk Engine",
    d: "Per-trade %, daily loss, drawdown, cooldown, symbol caps, plus win/loss streak-aware sizing.",
  },
  {
    i: Activity,
    t: "Real-time Monitoring",
    d: "Server-side TP/SL, trailing stops, and timeout exits — never miss a fill because your laptop was closed.",
  },
  {
    i: FlaskConical,
    t: "Backtesting Engine",
    d: "Replay any strategy against 90 days of Binance klines. Equity curve, max drawdown, profit factor.",
  },
  {
    i: BarChart3,
    t: "Analytics & Heat Map",
    d: "Per-channel PnL, symbol exposure heat map, adaptive multiplier attribution.",
  },
  {
    i: Users,
    t: "Affiliate Program",
    d: "30% / 10% / 5% across three levels. Recurring monthly payouts in USDT or bank transfer.",
  },
  {
    i: Clock,
    t: "24/7 Automation",
    d: "Cron-driven workers process orders, sync balances, and detect anomalies around the clock.",
  },
];

const steps = [
  {
    n: "01",
    t: "Connect an exchange",
    d: "Add a read/trade-only API key. Withdrawal permission is rejected on validation.",
  },
  {
    n: "02",
    t: "Subscribe to signals",
    d: "Link your Telegram channels or use platform-managed sources. Set per-channel risk overrides.",
  },
  {
    n: "03",
    t: "Let Hermes trade",
    d: "The risk engine sizes every order, the executor places it, and the monitor manages exits.",
  },
];

const exchanges = ["Binance", "Bybit", "OKX", "KuCoin", "MEXC"];

const testimonials = [
  {
    name: "Marcus T.",
    role: "Full-time trader",
    text: "The adaptive multiplier alone saved my month. It scaled me down through a losing streak I would've fought manually.",
  },
  {
    name: "Priya S.",
    role: "Signal group operator",
    text: "I run three channels through Hermes for my subscribers. The per-channel risk overrides and backtests are exactly what I needed.",
  },
  {
    name: "David L.",
    role: "Small fund manager",
    text: "We route four exchange accounts through one workstation. Kill-switch and audit logs made compliance sign-off trivial.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="mx-auto max-w-7xl px-6 pt-20 pb-14 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" /> Now in beta
          </span>
          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-semibold tracking-tight md:text-6xl">
            Automate your <span className="text-primary">signal trading</span> with risk you
            control.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            Hermes parses Telegram trading signals, enforces your risk rules, and executes across
            your exchange accounts — all in one workstation.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/auth"
              search={{ mode: "signup" } as never}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/pricing"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              See pricing
            </Link>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mx-auto max-w-5xl px-6 pb-16">
          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.l} className="text-center">
                <div className="text-3xl font-semibold text-primary">{s.v}</div>
                <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Exchange logos strip */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
          Trades on the venues you already use
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {exchanges.map((e) => (
            <div
              key={e}
              className="text-2xl font-semibold text-muted-foreground/70 transition hover:text-foreground"
            >
              {e}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Everything you need to run signals safely.
          </h2>
          <p className="mt-3 text-muted-foreground">Eight core systems, one workstation.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.t}
              className="rounded-xl border border-border bg-card p-6 transition hover:border-primary/40"
            >
              <f.i className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">{f.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">How it works</h2>
          <p className="mt-3 text-muted-foreground">
            Three steps from sign-up to first automated trade.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-border bg-card p-8">
              <div className="text-xs font-semibold tracking-widest text-primary">STEP {s.n}</div>
              <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Trusted by traders who ship.
          </h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <div key={t.name} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex gap-1 text-primary">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-foreground/90">"{t.text}"</p>
              <div className="mt-6 flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                  {t.name[0]}
                </div>
                <div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-2xl border border-primary/30 bg-card p-10 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Automate your edge today.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            7-day Premium trial, no card required. Cancel anytime.
          </p>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
