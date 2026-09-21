const url = process.env.SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}` };

(async () => {
  // inspect plans columns + current rows
  const r = await fetch(`${url}/rest/v1/plans?select=*&limit=5`, { headers: h });
  if (!r.ok) {
    console.log("ERR", r.status, await r.text());
    return;
  }
  const d = await r.json();
  console.log("PLANS:", JSON.stringify(d, null, 1));
})();
