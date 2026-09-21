// Connect a PAPER exchange account for a user (safe, no real API keys needed).
// Uses the app's AES-256-GCM encryptSecret with EXCHANGE_ENCRYPTION_KEY so the
// worker can decrypt (paper validator ignores keys).
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret } from "../src/lib/crypto.server.ts";

const USER_ID = "cd4e5536-2b65-45d7-9ab0-dc3a1e6e855a"; // Sajib / tg_5361037050

const url = process.env.SUPABASE_URL;
const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !roleKey) throw new Error("missing SUPABASE_URL / SERVICE_ROLE_KEY");
if (!process.env.EXCHANGE_ENCRYPTION_KEY) {
  throw new Error("missing EXCHANGE_ENCRYPTION_KEY");
}

const sb = createClient(url, roleKey, { auth: { persistSession: false } });

const apiKey = encryptSecret(`paper-key-${randomBytes(8).toString("hex")}`);
const apiSecret = encryptSecret(`paper-secret-${randomBytes(8).toString("hex")}`);

// idempotent: already connected?
const existing = await sb
  .from("exchange_accounts")
  .select("id,exchange_code,label,status,execution_mode,user_id,created_at")
  .eq("user_id", USER_ID)
  .eq("exchange_code", "paper")
  .maybeSingle();

if (existing.data) {
  console.log("PAPER_EXCHANGE_ALREADY_CONNECTED", JSON.stringify(existing.data));
} else {
  const { data, error } = await sb
    .from("exchange_accounts")
    .insert({
      user_id: USER_ID,
      exchange_code: "paper",
      label: "Paper Trading",
      encrypted_api_key: apiKey,
      encrypted_api_secret: apiSecret,
      status: "active",
      execution_mode: "paper",
      validated_at: new Date().toISOString(),
    })
    .select("id,exchange_code,label,status,execution_mode,user_id,created_at")
    .single();

  if (error) {
    console.error("INSERT_ERROR", error.message);
    process.exitCode = 1;
  } else {
    console.log("PAPER_EXCHANGE_CONNECTED", JSON.stringify(data));
  }
}
