import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, AlertTriangle, Scale, Ban, DollarSign, Shield, Mail } from "lucide-react";
import { PublicNav, PublicFooter } from "@/components/PublicNav";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — AI TRED AGENT" },
      {
        name: "description",
        content:
          "Terms of Service governing the use of AI TRED AGENT automated crypto signal trading platform — including risk disclosure, acceptable use, subscriptions, liability limits, and governing law.",
      },
      { property: "og:title", content: "Terms of Service — AI TRED AGENT" },
      {
        property: "og:description",
        content:
          "Terms of Service governing the use of AI TRED AGENT automated crypto signal trading platform.",
      },
    ],
  }),
  component: Page,
});

const sections = [
  {
    icon: FileText,
    title: "1. Acceptance of Terms",
    content:
      'By accessing or using the AI TRED AGENT platform ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you must not use the Service. We may update these Terms from time to time; material changes will be communicated via email and in-app notification at least 14 days before taking effect. Continued use of the Service after the effective date constitutes acceptance of the updated Terms.',
  },
  {
    icon: FileText,
    title: "2. Description of Service & Eligibility",
    content:
      "AI TRED AGENT provides an automated trading workstation that parses signals from Telegram channels and executes trades on third-party cryptocurrency exchanges. The Service is available to individuals and legal entities that are at least 18 years old (or the age of majority in their jurisdiction) and have the legal capacity to enter into binding contracts. By using the Service, you represent that you meet these eligibility requirements. The Service is not available in jurisdictions where automated crypto trading is prohibited.",
  },
  {
    icon: Shield,
    title: "3. Account Registration & API Keys",
    content:
      "You are responsible for maintaining the confidentiality of your account credentials. You must provide accurate, current, and complete information during registration. When connecting exchange API keys, you must use keys with trade and read permissions only — we reject keys with withdrawal, margin, or futures trading permissions enabled. You are solely responsible for all activity conducted through your account and API keys. You must notify us immediately of any unauthorized use of your account.",
  },
  {
    icon: Ban,
    title: "4. Acceptable Use",
    content:
      "You agree not to: (a) use the Service for any illegal activity or in violation of any applicable law; (b) attempt to reverse engineer, decompile, or disassemble the Service; (c) interfere with or disrupt the integrity or performance of the Service; (d) attempt to gain unauthorized access to the Service or its related systems; (e) use the Service to manipulate markets or engage in wash trading, spoofing, or any form of market abuse; (f) share your account credentials or API keys with unauthorized parties; (g) use bots, scrapers, or automated scripts outside the Service's intended API. Violation of these terms may result in immediate account suspension without notice.",
  },
  {
    icon: AlertTriangle,
    title: "5. Risk Disclosure",
    content:
      "Trading cryptocurrency involves substantial risk of financial loss. You acknowledge and agree that: (a) the Service is a tool that executes trades based on signals it parses — it does not provide financial advice, investment recommendations, or guaranteed returns; (b) past performance of any signal channel, backtest, or strategy does not guarantee future results; (c) you are solely responsible for all trading decisions and their outcomes; (d) market conditions, exchange outages, network latency, and signal parsing errors may result in trades that differ from the intended signal — including failure to execute, partial fills, or price slippage; (e) you should never trade with funds you cannot afford to lose. THE SERVICE IS PROVIDED 'AS IS' WITHOUT ANY WARRANTY OF PROFITABILITY.",
  },
  {
    icon: DollarSign,
    title: "6. Subscriptions, Billing & Refunds",
    content:
      "Paid plans are billed in advance on a monthly or annual basis. All prices are in USD and exclude applicable taxes. The 7-day free trial of Pro features begins at account creation; no payment method is required during the trial period. After the trial, you will be charged the applicable subscription fee unless you downgrade to the Free tier before the trial ends. You may cancel your subscription at any time from your billing settings. Cancellation takes effect at the end of the current billing period — no prorated refunds are issued for partial months. We reserve the right to change pricing with 30 days' notice. Continued use after the price change takes effect constitutes acceptance of the new pricing.",
  },
  {
    icon: DollarSign,
    title: "7. Affiliate Program Terms",
    content:
      "The affiliate program pays commissions based on the subscription revenue of referred customers. Commission rates are 30% for Level 1 (direct referrals), 10% for Level 2 (referrals by your referrals), and 5% for Level 3. Commissions are calculated monthly and paid within 15 days of the end of each calendar month. Payouts require a minimum balance of $50 and are sent via USDT (TRC-20 or ERC-20) or bank transfer. Self-referral, referral fraud, or any attempt to game the affiliate system is grounds for immediate forfeiture of all commissions and account termination. We reserve the right to modify affiliate commission rates with 30 days' notice applied to new referrals only.",
  },
  {
    icon: Shield,
    title: "8. Intellectual Property",
    content:
      "The Service, including its software, design, text, graphics, logos, and underlying technology, is the intellectual property of AI TRED AGENT, its licensors. You are granted a limited, non-exclusive, non-transferable, revocable license to use the Service in accordance with these Terms. You may not copy, modify, distribute, sell, or lease any part of the Service. Any feedback you provide about the Service may be used without compensation or obligation to you.",
  },
  {
    icon: AlertTriangle,
    title: "9. Disclaimer of Warranties",
    content:
      "THE SERVICE IS PROVIDED 'AS IS' AND 'AS AVAILABLE' WITHOUT ANY WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY OF SIGNAL PARSING. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, TIMELY, OR SECURE. NO ADVICE OR INFORMATION OBTAINED FROM THE SERVICE SHALL CREATE ANY WARRANTY NOT EXPRESSLY STATED IN THESE TERMS.",
  },
  {
    icon: AlertTriangle,
    title: "10. Limitation of Liability",
    content:
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL AI TRED AGENT, ITS AFFILIATES, DIRECTORS, OFFICERS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, LOSS OF TRADING CAPITAL, LOSS OF DATA, OR BUSINESS INTERRUPTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE TOTAL AMOUNT PAID BY YOU TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.",
  },
  {
    icon: Shield,
    title: "11. Indemnification",
    content:
      "You agree to indemnify, defend, and hold harmless AI TRED AGENT, its affiliates, and their respective officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; (d) your trading activity conducted through the Service; or (e) any dispute between you and a third-party exchange connected through the Service.",
  },
  {
    icon: Ban,
    title: "12. Termination",
    content:
      "We reserve the right to suspend or terminate your access to the Service at any time, with or without cause, with or without notice. Cause for termination includes: (a) violation of these Terms; (b) illegal or fraudulent activity; (c) non-payment of fees; (d) extended inactivity. Upon termination, your API keys will be revoked from our systems, your account will be disabled, and you will lose access to all data and features. You may terminate your account at any time by deleting it from your profile settings. Sections 5, 9, 10, 11, and 14 shall survive termination.",
  },
  {
    icon: Scale,
    title: "13. Governing Law & Dispute Resolution",
    content:
      "These Terms shall be governed by and construed in accordance with the laws of the State of California, USA, without regard to its conflict of law provisions. Any dispute arising from these Terms shall be resolved through binding arbitration in San Francisco, California, in accordance with the rules of the American Arbitration Association. You agree to waive any right to a jury trial or to participate in a class action. If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full force and effect.",
  },
  {
    icon: Mail,
    title: "14. Contact",
    content:
      "For questions about these Terms, please contact us at: legal@aitredagent.com. Notices of legal process should be sent to: AI TRED AGENT, Attn: Legal, 100 Crypto Street, Suite 200, San Francisco, CA 94105, USA. These Terms were last updated on August 1, 2026.",
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
            <Scale className="h-3 w-3" /> Last updated August 1, 2026
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
            Terms of <span className="text-primary">Service</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
            These Terms govern your use of the AI TRED AGENT platform. Please read them carefully — by
            using the Service, you agree to be bound by them.
          </p>
        </div>
      </section>

      {/* Sections */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="space-y-6">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <div key={section.title} className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {section.content}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-8 text-center">
          <Button asChild variant="outline">
            <Link to="/privacy">View our Privacy Policy</Link>
          </Button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
