const url = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}` };
(async () => {
  const r = await fetch(`${url}/rest/v1/notifications?select=id,event_type,title,telegram_dispatched_at,created_at&telegram_dispatched_at=not.is.null&order=created_at.desc&limit=8`, { headers: h });
  const d = await r.json().catch(() => []);
  console.log("dispatched count:", Array.isArray(d) ? d.length : 0);
  for (const n of Array.isArray(d) ? d : []) console.log(n.event_type, "|", (n.title || "").slice(0, 45), "|", n.telegram_dispatched_at);
})().catch((e) => console.error("ERR", e.message));
