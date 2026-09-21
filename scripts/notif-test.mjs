// AI TRED — notification dispatch end-to-end test.
// Runs INSIDE tred-assistant container so it has CRON_SECRET + SUPABASE service role in env.
// Uses the REAL deployed dispatch path: insert prefs+notification, POST to the cron hook,
// confirm telegram_dispatched_at gets set (i.e. the user's own MTProto session sent the msg).
const uid = "1c6eda73-3cbe-412c-8a15-6805d908e269"; // boss's user_id
const tgChatId = "7445166061"; // boss's tg_user_id (self DM / saved messages)
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: key,
  Authorization: "Bearer " + key,
  "Content-Type": "application/json",
};

async function j(r) {
  return r.json().catch(() => ({}));
}

(async () => {
  // 1) Upsert notification prefs (telegram channel ON, chat_id set, new_signal allowed)
  const prefsBody = {
    user_id: uid,
    email: null,
    telegram_chat_id: tgChatId,
    channel_email: false,
    channel_telegram: true,
    evt_fill: false,
    evt_sl_tp: false,
    evt_error: false,
    evt_invalid_keys: false,
    evt_new_signal: true,
  };
  const prefsRes = await j(
    await fetch(`${url}/rest/v1/user_notification_prefs?on_conflict=user_id`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(prefsBody),
    }),
  );
  console.log("prefs upsert:", JSON.stringify(prefsRes).slice(0, 200));

  // 2) Insert a test notification
  const notifBody = {
    user_id: uid,
    event_type: "new_signal",
    title: "AI TRED AGENT — Test Signal",
    body: "BTC/USDT LONG @ 67250 | SL 66800 | TP 68000 | Leverage 10x",
    metadata: { test: true },
  };
  const nota = await j(
    await fetch(`${url}/rest/v1/notifications`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(notifBody),
    }),
  );
  const nid = nota.id;
  console.log("notification inserted id:", nid);

  // 3) Trigger the dispatch hook with CRON_SECRET (from env, not echoed)
  const hook = "https://tred.agentsupport360.tech/api/public/hooks/dispatch-notifications";
  const hr = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
    body: JSON.stringify({}),
  });
  const hookJson = await j(hr);
  console.log("dispatch hook:", hr.status, JSON.stringify(hookJson));

  // 4) Read back the notification to confirm telegram_dispatched_at was set
  const row = await j(
    await fetch(
      `${url}/rest/v1/notifications?select=id,event_type,title,telegram_dispatched_at,email_dispatched_at,dispatch_attempts,last_dispatch_error&id=eq.${nid}`,
      { headers: H },
    ),
  );
  console.log("back-read:", JSON.stringify(row));

  const t = row?.[0];
  if (t && t.telegram_dispatched_at) {
    console.log("RESULT: TELEGRAM DISPATCHED via user's own session");
  } else {
    console.log("RESULT: telegram not dispatched:", t?.last_dispatch_error || "unknown");
  }
})().catch((e) => {
  console.error("fatal", e?.message || e);
  process.exit(1);
});
