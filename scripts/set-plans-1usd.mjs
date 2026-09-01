const url = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", Prefer: "return=representation" };
(async () => {
  let total = 0;
  for (const code of ["starter", "premium", "professional"]) {
    const r = await fetch(`${url}/rest/v1/plans?code=eq.${code}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ monthly_price: 1, yearly_price: 1, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) { console.log("ERR", code, r.status, await r.text()); return; }
    const d = await r.json();
    total += d.length;
    console.log(`${code}: -> $${d[0].monthly_price}/mo, $${d[0].yearly_price}/yr`);
  }
  console.log("TOTAL plans updated:", total);
  // read back to confirm persisted
  const rb = await fetch(`${url}/rest/v1/plans?select=code,name,monthly_price,yearly_price,is_active&order=sort_order`, { headers: h });
  console.log("READBACK:", JSON.stringify(await rb.json(), null, 1));
})();
