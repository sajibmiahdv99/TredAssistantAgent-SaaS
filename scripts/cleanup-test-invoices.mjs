import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("no creds"); process.exit(1); }
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const nums = ["TW-MTI8Q1Z9-YJX0", "TW-MTI9QID8-276Z", "TW-MTI9RO4E-YTIX"];
// delete invoices first (children), then their subscriptions (parents)
const { data: inv, error: e1 } = await admin.from("invoices").select("id,subscription_id,invoice_number").in("invoice_number", nums);
if (e1) console.log("inv sel err:", e1.message);
const subIds = [...new Set((inv || []).map((i) => i.subscription_id).filter(Boolean))];
const { error: e2 } = await admin.from("invoices").delete().in("invoice_number", nums);
console.log("invoices deleted:", e2 ? "ERR " + e2.message : (inv || []).length);
const { error: e3 } = await admin.from("subscriptions").delete().in("id", subIds);
console.log("subscriptions deleted:", e3 ? "ERR " + e3.message : subIds.length);
const { data: left } = await admin.from("invoices").select("invoice_number,status").order("created_at", { ascending: false }).limit(10);
console.log("remaining invoices:", JSON.stringify(left));
