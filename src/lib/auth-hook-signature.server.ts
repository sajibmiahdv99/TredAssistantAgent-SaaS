import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify the Standard Webhooks signature Supabase sends to HTTP auth hooks. */
export function verifyAuthHookSignature(body: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const encoded = secret.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(/\s+/).some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
