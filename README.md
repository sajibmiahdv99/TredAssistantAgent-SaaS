# Tred Assistant Agent

Automated crypto signal trading platform: Telegram signal ingestion, risk
engine, multi-exchange execution, backtesting, KYC, billing, affiliates, and
an admin panel.

## Development

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd TredAssistantAgent
npm i
npm run dev
```

Copy `.env.example` to `.env` and fill in your Supabase project details and
any optional integration keys (OpenAI, Resend, Telegram) before running.
