import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyAuthHookSignature } from "./auth-hook-signature.server";

describe("Supabase hook signature", () => {
  const key = Buffer.alloc(32, 7);
  const secret = `v1,whsec_${key.toString("base64")}`;
  const body = '{"user":{"email":"fixture@example.invalid"}}';
  const now = 1_800_000_000_000;
  const timestamp = String(now / 1000);
  function headers() {
    const signature = createHmac("sha256", key).update(`fixture.${timestamp}.${body}`).digest("base64");
    return new Headers({ "webhook-id": "fixture", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` });
  }
  it("accepts a valid Supabase signature", () => expect(verifyAuthHookSignature(body, headers(), secret, now)).toBe(true));
  it("rejects altered request content", () => expect(verifyAuthHookSignature(body + " ", headers(), secret, now)).toBe(false));
  it("rejects stale replay", () => expect(verifyAuthHookSignature(body, headers(), secret, now + 301_000)).toBe(false));
  it("rejects missing headers and unrelated keys", () => {
    expect(verifyAuthHookSignature(body, new Headers(), secret, now)).toBe(false);
    expect(verifyAuthHookSignature(body, headers(), `whsec_${Buffer.alloc(32, 8).toString("base64")}`, now)).toBe(false);
  });
});
