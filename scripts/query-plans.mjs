const url = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: k, Authorization: "Bearer " + k };
const r = await fetch(url + "/rest/v1/plans?select=*", { headers: h });
const d = await r.json();
if (Array.isArray(d)) {
  console.log("count:", d.length);
  for (const p of d) {
    // print keys + any value-ish fields (mask long strings)
    const slim = {};
    for (const [kk, vv] of Object.entries(p)) {
      if (typeof vv === "string" && vv.length > 40) slim[kk] = vv.slice(0, 12) + "…";
      else slim[kk] = vv;
    }
    console.log(JSON.stringify(slim));
  }
} else {
  console.log("RESP:", JSON.stringify(d));
}