import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// grab a valid plan code + a real user id
const { data: planRow } = await admin.from("plans").select("code").limit(1).maybeSingle();
const planCode = planRow?.code;
if (!planCode) { console.log("NO_PLAN_CODE"); process.exit(1); }

const { data: uRow } = await admin.from("profiles").select("id").limit(1).maybeSingle();
if (!uRow?.id) { console.log("NO_USER"); process.exit(1); }
const userId = uRow.id;
const { data: sub, error: subErr } = await admin
  .from("subscriptions")
  .insert({ user_id: userId, plan_code: planCode, status: "pending", billing_interval: "monthly" })
  .select("id").single();
if (subErr) { console.log("SUB_INSERT_ERR", subErr.message); process.exit(1); }

const invNum = `TW-BSC-AUTOCHK-${Date.now().toString(36).toUpperCase()}`;
const { data: inv, error: invErr } = await admin
  .from("invoices")
  .insert({ user_id: userId, amount: 3, currency: "USD", status: "pending", subscription_id: sub.id, invoice_number: invNum })
  .select("id").single();
if (invErr) { console.log("INV_INSERT_ERR", invErr.message); process.exit(1); }

const { confirmPendingCryptoPayments } = await import("../src/lib/crypto-pay.confirm.server.ts");
const res = await confirmPendingCryptoPayments();
console.log("AUTO-CONFIRM RESULT:", JSON.stringify(res), "| expect checked>=1, confirmed=0 (no real transfer)");

// cleanup
await admin.from("invoices").delete().eq("id", inv.id);
await admin.from("subscriptions").delete().eq("id", sub.id);
console.log("CLEANUP_DONE");
