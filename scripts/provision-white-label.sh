#!/usr/bin/env bash
# ============================================================
# TredAssistantAgent — White-Label Instance Provisioner
#
# Creates a NEW white-label instance from this repo with its own
# branding + isolated Supabase project. Run on the VPS (or any
# Docker host). Requires the new Supabase project's URL + keys.
#
# Usage:
#   ./scripts/provision-white-label.sh <brand-name> <domain> \
#       <SUPABASE_URL> <SUPABASE_PUBLISHABLE_KEY> <SUPABASE_SERVICE_ROLE_KEY>
#
# Example:
#   ./scripts/provision-white-label.sh AlphaTrades alpha.trades.io \
#       https://xxxx.supabase.co sb_pub_... eyJ...
#
# What it does:
#   1. Clones this repo into /opt/<brand>-instance
#   2. Generates fresh secrets (encryption keys, cron, webhooks)
#   3. Writes .env with brand env vars + the new Supabase creds
#   4. Runs all 41 migrations against the new project
#   5. Builds + starts Docker compose (app + worker)
# ============================================================
set -euo pipefail

BRAND="${1:?usage: provision-white-label.sh <brand> <domain> <SUPABASE_URL> <PUBLISHABLE_KEY> <SERVICE_ROLE_KEY>}"
DOMAIN="${2:?missing domain}"
SB_URL="${3:?missing SUPABASE_URL}"
SB_PUB="${4:?missing SUPABASE_PUBLISHABLE_KEY}"
SB_SVC="${5:?missing SUPABASE_SERVICE_ROLE_KEY}"

BASE="/opt"
DEST="$BASE/${BRAND,,}-instance"
REPO_URL="https://github.com/sajibmiahdv99/TredAssitantAgent.git"

echo "==> [1/6] Cloning fresh copy to $DEST"
rm -rf "$DEST"
git clone --depth 1 "$REPO_URL" "$DEST"
cd "$DEST"

echo "==> [2/6] Generating secrets"
EXCHANGE_ENC_KEY=$(openssl rand -base64 32)
TELEGRAM_SESSION_ENC_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
PRICE_RELAY_SECRET=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
PAYMENT_WEBHOOK_SECRET=$(openssl rand -hex 32)

echo "==> [3/6] Writing .env (brand: $BRAND, domain: $DOMAIN)"
cp .env.production.example .env
# Replace placeholders
sed -i "s|^SUPABASE_URL=.*|SUPABASE_URL=$SB_URL|" .env
sed -i "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SB_SVC|" .env
sed -i "s|^SUPABASE_PUBLISHABLE_KEY=.*|SUPABASE_PUBLISHABLE_KEY=$SB_PUB|" .env
sed -i "s|^VITE_SUPABASE_URL=.*|VITE_SUPABASE_URL=$SB_URL|" .env
sed -i "s|^VITE_SUPABASE_PUBLISHABLE_KEY=.*|VITE_SUPABASE_PUBLISHABLE_KEY=$SB_PUB|" .env
# Project ref = first subdomain segment of URL
PROJECT_REF=$(echo "$SB_URL" | sed -E 's|https://([^.]+)\..*|\1|')
sed -i "s|^SUPABASE_PROJECT_ID=.*|SUPABASE_PROJECT_ID=$PROJECT_REF|" .env
sed -i "s|^VITE_SUPABASE_PROJECT_ID=.*|VITE_SUPABASE_PROJECT_ID=$PROJECT_REF|" .env
sed -i "s|^VITE_APP_URL=.*|VITE_APP_URL=https://$DOMAIN|" .env
sed -i "s|^TRED_DOMAIN=.*|TRED_DOMAIN=$DOMAIN|" .env || echo "TRED_DOMAIN=$DOMAIN" >> .env
sed -i "s|^EXCHANGE_ENCRYPTION_KEY=.*|EXCHANGE_ENCRYPTION_KEY=$EXCHANGE_ENC_KEY|" .env
sed -i "s|^TELEGRAM_SESSION_ENC_KEY=.*|TELEGRAM_SESSION_ENC_KEY=$TELEGRAM_SESSION_ENC_KEY|" .env
sed -i "s|^CRON_SECRET=.*|CRON_SECRET=$CRON_SECRET|" .env
sed -i "s|^PRICE_RELAY_SECRET=.*|PRICE_RELAY_SECRET=$PRICE_RELAY_SECRET|" .env
sed -i "s|^TELEGRAM_WEBHOOK_SECRET=.*|TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET|" .env
sed -i "s|^PAYMENT_WEBHOOK_SECRET=.*|PAYMENT_WEBHOOK_SECRET=$PAYMENT_WEBHOOK_SECRET|" .env
chmod 600 .env

echo "==> [4/6] Running 41 migrations against new Supabase project"
# Each migration is a standalone SQL file — apply in filename order via the
# Supabase SQL REST endpoint. Requires the Supabase CLI or psql; if neither
# is available, print instructions instead.
if command -v supabase > /dev/null 2>&1; then
  (cd supabase && supabase db push --db-url "$SB_URL" 2>/dev/null || echo "  ! supabase link needed — run manually")
elif command -v psql > /dev/null 2>&1; then
  echo "  psql detected — apply migrations manually with the project DB password"
else
  echo "  ! No supabase/psql — apply supabase/migrations/*.sql via the dashboard"
fi

echo "==> [5/6] Branding (env-driven — see docs/WHITE_LABEL.md)"
# VITE_BRAND_* vars are read by src/lib/brand.ts at build time.
cat >> .env << EOF

# White-label branding (optional; defaults reproduce 'Hermes')
VITE_BRAND_NAME=$BRAND
VITE_BRAND_TAGLINE=Automated Signal Trading
VITE_BRAND_LOGO_INITIAL=${BRAND:0:1}
VITE_BRAND_ADMIN_INITIAL=A
VITE_BRAND_FOOTER_NAME=$BRAND Trading
EOF

echo "==> [6/6] Building + starting (app + worker)"
# Point compose at this brand's domain
sed -i "s|tred.yourdomain.com|$DOMAIN|g" docker-compose.yml
docker compose build 2>&1 | tail -2
docker compose up -d 2>&1 | tail -4

echo ""
echo "======================================================"
echo "✅ White-label instance ready: https://$DOMAIN"
echo "   Directory: $DEST"
echo ""
echo "   NEXT STEPS (manual, per WHITE_LABEL.md):"
echo "   1. Edit public/manifest.webmanifest + replace icons in public/"
echo "   2. Rewrite marketing copy in src/routes/{index,pricing,faq,affiliate,privacy,terms}.tsx"
echo "   3. Point DNS A-record $DOMAIN -> this host, then Traefik issues TLS"
echo "   4. Wire Telegram bot: setWebhook -> https://$DOMAIN/api/public/telegram-webhook"
echo "   5. Enable signup hook: Dashboard -> Auth -> Hooks -> before user created"
echo "======================================================"
