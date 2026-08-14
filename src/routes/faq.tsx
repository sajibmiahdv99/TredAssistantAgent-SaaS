import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, HelpCircle, Search } from "lucide-react";
import { PublicNav, PublicFooter } from "@/components/PublicNav";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — Hermes" },
      {
        name: "description",
        content:
          "Answers to common questions about Hermes — signal parsing, exchange API key safety, the risk engine, backtesting, subscriptions, the affiliate program, and more.",
      },
      { property: "og:title", content: "FAQ — Hermes" },
      {
        property: "og:description",
        content:
          "Answers to common questions about Hermes signal trading, risk controls, and subscriptions.",
      },
    ],
  }),
  component: Page,
});

const faqs = [
  {
    value: "what-is-hermes",
    q: "What is Hermes?",
    a: "Hermes is an automated crypto signal trading workstation. It parses trading signals from Telegram channels using a hybrid AI-plus-regex engine, enforces your risk rules, and executes trades across your exchange accounts — all in one place. You can run in paper trading mode to test strategies, then switch to live execution when you're ready.",
  },
  {
    value: "signal-parsing",
    q: "How does signal parsing work?",
    a: "Hermes uses a two-layer approach: a regex-based parser extracts structured fields (symbol, direction, entry price, stop-loss, take-profit targets) from common signal formats, and an AI parser (optional, Pro tier) handles free-form or inconsistent signal text. The system learns from corrections and adapts to your channels over time. You can preview how every signal is parsed in the sources panel before it triggers a trade.",
  },
  {
    value: "api-key-safety",
    q: "Are my exchange API keys safe?",
    a: "Yes. API keys are encrypted at rest using AES-256-GCM with per-key derivation. We reject any key that has withdrawal permission enabled during validation — only trade and read permissions are allowed. Keys never leave our encrypted database unencrypted, are never logged, and are never shared with third parties. You can revoke or rotate them at any time from your exchange settings. We also recommend IP allowlisting your exchange API keys to our server IPs for an additional layer of security.",
  },
  {
    value: "risk-engine",
    q: "What does the risk engine do?",
    a: "The adaptive risk engine enforces per-trade size limits (as a percentage of your balance), a daily loss cap, a maximum drawdown threshold, cooldown periods after losses, per-symbol position caps, and win/loss streak-aware sizing. It's designed to prevent a single bad signal from blowing up your account. All rules can be configured globally and overridden per signal channel. The engine runs server-side, so it stays active even when your device is offline.",
  },
  {
    value: "backtesting",
    q: "Can I backtest before going live?",
    a: "Yes. The backtesting engine replays any strategy against up to 90 days of 1-minute Binance klines (Pro tier). You can see the full equity curve, maximum drawdown, profit factor, win rate, and Sharpe ratio. Paper trading is available on the Free tier so you can validate strategies in real-time without risking capital. We recommend backtesting on at least 30 days of data before enabling live execution.",
  },
  {
    value: "exchanges-supported",
    q: "Which exchanges are supported?",
    a: "Binance and Bybit are fully supported today. OKX, KuCoin, and MEXC are currently in development and rolling out in the coming weeks. We also have a unified adapter architecture and offer MT5 (MetaTrader 5) and DEX integration for Enterprise customers. If you need a specific exchange, reach out to support and we'll prioritize it.",
  },
  {
    value: "kyc",
    q: "Do I need to complete KYC?",
    a: "Hermes does not require KYC or identity verification to use the platform. However, the crypto exchanges you connect to may have their own KYC requirements — you must comply with those. We only ask for an email address at signup so we can send you account notifications and receipts.",
  },
  {
    value: "subscription-cancel",
    q: "How do subscriptions and cancellation work?",
    a: "Every new account gets a 7-day free trial of Pro features with no credit card required. After the trial, you can continue on the Free tier or subscribe to Pro ($49/month, with annual billing available at a 20% discount). You can cancel anytime from your billing settings — Pro access continues until the end of the current billing period. We do not prorate refunds for partial months, but you will not be charged again after cancellation.",
  },
  {
    value: "affiliate-program",
    q: "How does the affiliate program work?",
    a: "The Hermes affiliate program pays 30% commission on referred customers' subscription revenue (Level 1), 10% on referrals made by your referrals (Level 2), and 5% on a third level. Commissions are recurring monthly for as long as your referrals remain active subscribers. Payouts are processed monthly in USDT (TRC-20 or ERC-20) or via bank transfer, with a minimum threshold of $50. You can track your referrals, earnings, and payouts from the affiliate dashboard.",
  },
  {
    value: "paper-trading",
    q: "What is paper trading and how do I use it?",
    a: "Paper trading simulates live execution with virtual funds — no real money is at risk. Hermes generates a virtual balance, processes signals through the same risk engine and execution pipeline, and reports fills, PnL, and portfolio stats as if trades were real. It's the best way to evaluate a signal channel or test a risk configuration before going live. You can switch between paper and live mode per account or use a dedicated paper trading API key from your exchange.",
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
            <HelpCircle className="h-3 w-3" /> Got questions?
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
            Frequently asked <span className="text-primary">questions</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            Everything you need to know about Hermes — from signal parsing and API key security to
            subscriptions, backtesting, and the affiliate program.
          </p>
        </div>
      </section>

      {/* Accordion */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <Accordion type="single" collapsible className="space-y-3">
          {faqs.map((faq) => (
            <AccordionItem
              key={faq.value}
              value={faq.value}
              className="rounded-xl border border-border bg-card px-6"
            >
              <AccordionTrigger className="py-4 text-left font-medium hover:no-underline">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Still have questions */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Search className="mx-auto h-6 w-6 text-primary" />
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Still have questions?</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            Reach out to our support team and we'll get back to you within a few hours — usually
            faster.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild variant="outline">
              <a href="mailto:support@hermesagent.com">Email support</a>
            </Button>
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" } as never}>
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
