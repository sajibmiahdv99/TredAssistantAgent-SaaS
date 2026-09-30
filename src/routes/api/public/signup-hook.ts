// Supabase Auth HTTP hook — "before user created".
// Called by Supabase Auth with { user, metadata: { ip_address, ... } }.
// Returns {} to allow, or an error object to reject signup.
//
// Checks the signup IP against:
//   1. The app's own signup_blocked_networks table (exact + CIDR prefix).
//   2. ip-api.com (free, no key) — proxies/VPNs/datacenter IPs are denied.
//   3. AbuseIPDB (optional) — only when ABUSEIPDB_API_KEY is set.
//
// Wire-up: Supabase Dashboard → Auth → Hooks → "before user created" →
// HTTP hook → URL https://<domain>/api/public/signup-hook
// Set the same Standard Webhooks secret in SUPABASE_AUTH_HOOK_SECRET on the server.

import { createFileRoute } from "@tanstack/react-router";
import { BlockList, isIP } from "node:net";
import { verifyAuthHookSignature } from "@/lib/auth-hook-signature.server";

let cachedBlocks: { list: BlockList; expiresAt: number } | null = null;

async function isIpBlockedInDb(ip: string): Promise<boolean> {
  const family = isIP(ip) === 6 ? "ipv6" : "ipv4";
  if (cachedBlocks && cachedBlocks.expiresAt > Date.now()) return cachedBlocks.list.check(ip, family);
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Signup configuration unavailable");
    const sb = createClient(url, key, { auth: { persistSession: false } });

    const { data, error, count } = await sb
      .from("signup_blocked_networks")
      .select("cidr", { count: "exact" })
      .abortSignal(AbortSignal.timeout(2000));
    if (error) throw new Error("Signup blocklist unavailable");
    if (count !== null && count > (data?.length ?? 0)) throw new Error("Signup blocklist incomplete");
    const blocks = new BlockList();
    for (const row of data ?? []) {
      const [address, prefix] = row.cidr.split("/");
      const type = isIP(address) === 6 ? "ipv6" : "ipv4";
      if (prefix === undefined) blocks.addAddress(address, type);
      else blocks.addSubnet(address, Number(prefix), type);
    }
    cachedBlocks = { list: blocks, expiresAt: Date.now() + 60_000 };
    return blocks.check(ip, family);
  } catch {
    throw new Error("Signup blocklist unavailable");
  }
}

async function ipApiReputation(ip: string): Promise<{
  proxy: boolean;
  hosting: boolean;
  country?: string;
  risk: "low" | "high";
}> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,countryCode,proxy,hosting,query`,
      {
        signal: AbortSignal.timeout(700),
      },
    );
    if (!res.ok) return { proxy: false, hosting: false, risk: "low" };
    const j = (await res.json()) as {
      status: string;
      countryCode?: string;
      proxy?: boolean;
      hosting?: boolean;
      query?: string;
    };
    if (j.status !== "success") return { proxy: false, hosting: false, risk: "low" };
    const proxy = !!j.proxy;
    const hosting = !!j.hosting;
    return {
      proxy,
      hosting,
      country: j.countryCode,
      risk: proxy || hosting ? "high" : "low",
    };
  } catch {
    return { proxy: false, hosting: false, risk: "low" };
  }
}

async function abuseIpdbReputation(ip: string): Promise<number | null> {
  const key = process.env.ABUSEIPDB_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=30`,
      {
        headers: { Key: key, Accept: "application/json" },
        signal: AbortSignal.timeout(700),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { abuseConfidenceScore?: number } };
    return j.data?.abuseConfidenceScore ?? null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/signup-hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET;
        if (!hookSecret || !verifyAuthHookSignature(raw, request.headers, hookSecret)) {
          return Response.json({ error: { http_code: 401, message: "Invalid hook signature" } }, { status: 401 });
        }
        // Rate limit: 30 signup-hook calls/min/IP (brute-force protection).
        const { rateLimitMiddleware } = await import("@/lib/rate-limit");
        const limited = rateLimitMiddleware(request, { windowMs: 60_000, maxRequests: 30 });
        if (limited) return limited;

        let body: { user?: { email?: string }; metadata?: { ip_address?: string } } = {};
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          return Response.json({ error: { http_code: 400, message: "Invalid hook payload" } }, { status: 400 });
        }

        const ip = body.metadata?.ip_address;
        // No IP info — can't judge, allow (auth still handles credentials).
        if (!ip) return Response.json({});
        if (!isIP(ip)) return Response.json({ error: { http_code: 400, message: "Invalid signup IP" } }, { status: 400 });

        // 1. Local blocklist
        let blocked: boolean;
        try { blocked = await isIpBlockedInDb(ip); } catch {
          return Response.json({ error: { http_code: 503, message: "Signup checks temporarily unavailable" } }, { status: 503 });
        }
        if (blocked) {
          return Response.json({
            error: { http_code: 403, message: "Signup from this network is blocked." },
          }, { status: 403 });
        }

        // 2. ip-api reputation
        const rep = await ipApiReputation(ip);
        if (rep.proxy || rep.hosting) {
          return Response.json({
            error: { http_code: 403, message: "Signups from proxies/VPNs are not allowed." },
          }, { status: 403 });
        }

        // 3. AbuseIPDB (optional key)
        const score = await abuseIpdbReputation(ip);
        if (score != null && score >= 50) {
          return Response.json({
            error: { http_code: 403, message: "This IP address has been flagged for abuse." },
          }, { status: 403 });
        }

        return Response.json({});
      },
    },
  },
});
