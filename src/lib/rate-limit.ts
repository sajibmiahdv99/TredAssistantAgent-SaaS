// Simple in-memory rate limiter for serverless/edge environments.
// Uses a sliding window per IP/token. Not persisted — resets on restart.
// For multi-instance deployments, swap this for a Redis-backed limiter.

export interface RateLimitConfig {
  windowMs: number;   // sliding window in ms (default: 60_000 = 1 minute)
  maxRequests: number; // max requests per window (default: 30)
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
  retryAfterMs: number | null;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const store = new Map<string, Bucket>();

// Periodic cleanup every 5 minutes to prevent memory leak
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    store.forEach((bucket, key) => {
      if (now - bucket.windowStart > 120_000) store.delete(key);
    });
  }, 300_000).unref?.();
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = { windowMs: 60_000, maxRequests: 30 },
): RateLimitResult {
  const now = Date.now();
  let bucket = store.get(key);

  if (!bucket || now - bucket.windowStart > config.windowMs) {
    // New window
    bucket = { count: 1, windowStart: now };
    store.set(key, bucket);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
      retryAfterMs: null,
    };
  }

  bucket.count++;
  if (bucket.count <= config.maxRequests) {
    return {
      allowed: true,
      remaining: config.maxRequests - bucket.count,
      resetAt: bucket.windowStart + config.windowMs,
      retryAfterMs: null,
    };
  }

  const retryAfter = bucket.windowStart + config.windowMs - now;
  return {
    allowed: false,
    remaining: 0,
    resetAt: bucket.windowStart + config.windowMs,
    retryAfterMs: retryAfter,
  };
}

export function rateLimitMiddleware(
  request: Request,
  config?: RateLimitConfig,
): Response | null {
  // Use IP from headers (Cloudflare/X-Forwarded-For) or a default
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const result = checkRateLimit(ip, config);

  // Always set rate-limit headers (even on allowed requests)
  const headers = new Headers({
    "X-RateLimit-Limit": String(config?.maxRequests ?? 30),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  });

  if (!result.allowed) {
    headers.set("Retry-After", String(Math.ceil((result.retryAfterMs ?? 60_000) / 1000)));
    return new Response(JSON.stringify({ error: "rate limit exceeded", retryAfterMs: result.retryAfterMs }), {
      status: 429,
      headers,
    });
  }

  return null; // no rate limit hit — continue
}