// Supabase Auth HTTP hook — "before user created".
// Called by Supabase Auth with { user, metadata: { ip_address, ... } }.
// Returns { decision: "allow" | "deny", message? }.
//
// Checks the signup IP against:
//   1. The app's own signup_blocked_networks table (exact + CIDR prefix).
//   2. ip-api.com (free, no key) — proxies/VPNs/datacenter IPs are denied.
//   3. AbuseIPDB (optional) — only when ABUSEIPDB_API_KEY is set.
//
// Wire-up: Supabase Dashboard → Auth → Hooks → "before user created" →
// HTTP hook → URL https://<domain>/api/public/signup-hook
// (no secret token needed; the hook is public by design and returns deny
//  only for clear abuse signals).

import { createFileRoute } from "@tanstack/react-router";

const BLOCKED_IP_CACHE_TTL_MS = 60_000;

async function isIpBlockedInDb(ip: string): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;
    const sb = createClient(url, key, { auth: { persistSession: false } });

    // Exact match
    const { data: exact } = await sb
      .from("signup_blocked_networks")
      .select("id")
      .eq("ip_or_cidr", ip)
      .limit(1);
    if (exact?.length) return true;

    // /24 prefix match (simple heuristic — covers most blocklists)
    const parts = ip.split(".");
    if (parts.length === 4) {
      const cidr24 = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      const { data: p24 } = await sb
        .from("signup_blocked_networks")
        .select("id")
        .eq("ip_or_cidr", cidr24)
        .limit(1);
      if (p24?.length) return true;
    }
    return false;
  } catch {
    return false;
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
        signal: AbortSignal.timeout(3000),
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
        signal: AbortSignal.timeout(3000),
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
        // Rate limit: 30 signup-hook calls/min/IP (brute-force protection).
        const { rateLimitMiddleware } = await import("@/lib/rate-limit");
        const limited = rateLimitMiddleware(request, { windowMs: 60_000, maxRequests: 30 });
        if (limited) return limited;

        let body: { user?: { email?: string }; metadata?: { ip_address?: string } } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ decision: "allow" });
        }

        const ip = body.metadata?.ip_address;
        // No IP info — can't judge, allow (auth still handles credentials).
        if (!ip) return Response.json({ decision: "allow" });

        // 1. Local blocklist
        if (await isIpBlockedInDb(ip)) {
          return Response.json({
            decision: "deny",
            message: "Signup from this network is blocked.",
          });
        }

        // 2. ip-api reputation
        const rep = await ipApiReputation(ip);
        if (rep.proxy || rep.hosting) {
          return Response.json({
            decision: "deny",
            message: "Signups from proxies/VPNs are not allowed.",
          });
        }

        // 3. AbuseIPDB (optional key)
        const score = await abuseIpdbReputation(ip);
        if (score != null && score >= 50) {
          return Response.json({
            decision: "deny",
            message: "This IP address has been flagged for abuse.",
          });
        }

        return Response.json({ decision: "allow" });
      },
    },
  },
});
