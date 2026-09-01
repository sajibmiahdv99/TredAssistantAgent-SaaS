// Verify BOTH: (a) parseMode lowercase 'html' works, (b) which chat_id getEntity+delivery works.
import { createDecipheriv, createHash } from "crypto";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const uid = "1c6eda73-3cbe-412c-8a15-6805d908e269";
const H = { apikey: key, Authorization: "Bearer " + key };

function loadKey(envName) {
  const raw = process.env[envName]; if (!raw) throw new Error(envName+" not configured");
  const d = Buffer.from(raw, "base64"); return d.length === 32 ? d : createHash("sha256").update(raw, "utf8").digest();
}
function decryptSession(payload) {
  const k = loadKey("TELEGRAM_SESSION_ENC_KEY");
  if (!payload || !payload.startsWith("v1:")) return payload;
  const [, a, b, c] = payload.split(":");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(a, "base64"));
  d.setAuthTag(Buffer.from(b, "base64"));
  return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8");
}

async function trySend(client, chatId, label) {
  try {
    const entity = await client.getEntity(chatId);
    const r = await client.sendMessage(entity, { message: `✅ AI TRED AGENT notification test (${label}) — parseMode html`, parseMode: "html" });
    console.log(`  OK chatId=${chatId} (${label}) -> sent msg id ${r?.id ?? "?"}`);
    return true;
  } catch (e) {
    console.log(`  FAIL chatId=${chatId} (${label}) -> ${e?.message || e}`);
    return false;
  }
}

(async () => {
  const accRes = await (await fetch(`${url}/rest/v1/telegram_accounts?select=session_ref,tg_user_id,tg_username&user_id=eq.${uid}&order=created_at.asc&limit=1`, { headers: H })).json();
  const acc = accRes?.[0];
  if (!acc?.session_ref) { console.log("no session_ref"); process.exit(1); }
  const sessionString = decryptSession(acc.session_ref);
  console.log("session decrypted OK, len:", sessionString.length);
  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, { connectionRetries: 2, useWSS: true, deviceModel: "AI TRED AGENT" });
  await client.connect();
  console.log("connected as me:", (await client.getMe())?.username);

  const ids = ["7445166061", "@sk676789", "me"];
  for (const id of ids) await trySend(client, id, "parseMode=html");

  await client.disconnect().catch(()=>{});
})().catch(e => { console.error("fatal", e?.message || e); process.exit(1); });
