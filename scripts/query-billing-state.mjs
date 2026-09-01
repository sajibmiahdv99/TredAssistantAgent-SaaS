const url = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: "Bearer " + k };
async function q(path) {
  const r = await fetch(url + path, { headers: h });
  return r.json();
}
const inv = await q("/rest/v1/invoices?select=*&order=created_at.desc");
const subs = await q("/rest/v1/subscriptions?select=*&order=created_at.desc");
console.log("=== INVOICES ===");
for (const i of (Array.isArray(inv) ? inv : [])) {
  console.log(JSON.stringify({ id: i.id, user_id: i.user_id, invoice_number: i.invoice_number, amount: i.amount, currency: i.currency, network: i.network, status: i.status, tx_hash: i.tx_hash, created_at: i.created_at, paid_at: i.paid_at }));
}
console.log("=== SUBSCRIPTIONS ===");
for (const s of (Array.isArray(subs) ? subs : [])) {
  console.log(JSON.stringify({ id: s.id, user_id: s.user_id, plan_code: s.plan_code, billing_interval: s.billing_interval, status: s.status, current_period_ends_at: s.current_period_ends_at, created_at: s.created_at }));
}