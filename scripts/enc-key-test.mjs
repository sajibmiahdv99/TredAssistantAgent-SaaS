import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
const FORMAT_VERSION = "v1";
function loadKey(envName) {
  const raw = process.env[envName];
  if (!raw) throw new Error(envName + " not configured");
  const d = Buffer.from(raw, "base64");
  if (d.length === 32) return d;
  return createHash("sha256").update(raw, "utf8").digest();
}
function enc(key, pt) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(pt, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${FORMAT_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}
function dec(key, payload) {
  if (!payload.startsWith(FORMAT_VERSION + ":")) return payload;
  const [, a, b, c] = payload.split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(a, "base64"));
  d.setAuthTag(Buffer.from(b, "base64"));
  return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8");
}
function test(envName) {
  const key = loadKey(envName);
  const sample = JSON.stringify({ sessionString: "1BcFakeSession--abc123----" + Date.now(), phone_e164: "+8801700000000", n: Math.random() });
  const ct = enc(key, sample);
  const pt = dec(key, ct);
  const ok = pt === sample;
  let tamper = "—";
  try { dec(key, ct.slice(0, ct.length - 4) + "AAAA"); tamper = "NO-ERROR(BAD)"; }
  catch { tamper = "rejected-gcm OK"; }
  console.log(`${envName}: roundtrip=${ok ? "OK" : "FAIL"}  tamper=${tamper}`);
  return ok;
}
let all = true;
for (const n of ["TELEGRAM_SESSION_ENC_KEY", "EXCHANGE_ENCRYPTION_KEY"]) {
  try { all = test(n) && all; } catch (e) { console.log(n + ": ERROR " + e.message); all = false; }
}
console.log(all ? "ALL ENC KEYS OK" : "SOME ENC KEY PROBLEM");
process.exit(all ? 0 : 1);
