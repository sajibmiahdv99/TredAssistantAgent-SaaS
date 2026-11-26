// Channel signal poller — reads new messages from users' linked Telegram
// channels via THEIR OWN MTProto session (no bot required). Works because
// the linked account is a member of the channel.
//
// Flow per tick:
//   1. Load telegram_accounts (status=active) + their channels where
//      is_signal_source=true.
//   2. For each channel: fetch recent messages, ingest any whose id is
//      newer than the channel's last_processed_message_id.
//   3. Update last_processed_message_id (migration adds the column).
//
// Best-effort: individual failures are logged, never crash the loop.
// Flood handling: back off per account on FLOOD_WAIT.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptSession } from "../src/lib/crypto.server.ts";
import { fetchChannelMessages } from "../src/lib/telegram/mtproto.server.ts";

type AccountRow = {
  id: string;
  user_id: string;
  session_ref: string;
};

type ChannelRow = {
  id: string;
  user_id: string;
  telegram_account_id: string | null;
  tg_chat_id: number | null;
  name: string;
  last_processed_message_id: number | null;
};

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function log(msg: string): void {
  console.log(`[channel-poller] ${new Date().toISOString()} ${msg}`);
}

/**
 * Pure, exported for tests: given the fetched messages (any order) and the
 * channel cursor, return the deduped, oldest-first list of messages that still
 * need ingestion.
 */
export function planNewMessages<T extends { id: number }>(
  messages: T[],
  lastProcessed: number | null,
): T[] {
  const seen = new Set<number>();
  return messages
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return lastProcessed == null || m.id > lastProcessed;
    })
    .sort((a, b) => a.id - b.id);
}

export async function pollSignalChannelsOnce(): Promise<{
  checked: number;
  ingested: number;
}> {
  if (!SB_URL || !SB_KEY) return { checked: 0, ingested: 0 };
  const sb: SupabaseClient = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Load accounts + channels
  const [{ data: accounts }, { data: channels }] = await Promise.all([
    sb.from("telegram_accounts").select("id,user_id,session_ref").eq("status", "active"),
    sb
      .from("personal_signal_channels")
      .select("id,user_id,telegram_account_id,tg_chat_id,name,last_processed_message_id")
      .eq("is_signal_source", true)
      .eq("is_active", true),
  ]);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a as AccountRow]));
  const targets = (channels ?? []).filter(
    (c) => c.telegram_account_id && accountById.has(c.telegram_account_id) && c.tg_chat_id != null,
  ) as ChannelRow[];

  if (!targets.length) return { checked: 0, ingested: 0 };
  log(`checking ${targets.length} channel(s)`);

  let ingested = 0;
  const { ingestSignalForSource } = await import("../src/lib/pipeline.functions.ts");

  for (const ch of targets) {
    const acc = accountById.get(ch.telegram_account_id!)!;
    let session: string;
    try {
      session = decryptSession(acc.session_ref);
    } catch (e) {
      log(`account ${acc.id}: session decrypt failed: ${String(e).slice(0, 100)}`);
      continue;
    }
    if (!session) {
      log(`account ${acc.id}: empty session`);
      continue;
    }

    // Resolve (or auto-create) the signal_sources row for this chat, so the
    // pipeline has a source_id to attach and the admin Sources page shows it.
    const chatCode = String(ch.tg_chat_id);
    const { data: existing } = await sb
      .from("signal_sources")
      .select("id,status")
      .eq("source_type", "telegram")
      .eq("code", chatCode)
      .maybeSingle();
    let sourceId: string | null = null;
    if (existing) {
      sourceId = existing.id;
    } else {
      const { data: created, error: createErr } = await sb
        .from("signal_sources")
        .insert({
          code: chatCode,
          name: ch.name,
          description: "Auto-created from linked Telegram channel",
          source_type: "telegram",
          status: "active",
          is_platform_managed: false,
        })
        .select("id")
        .single();
      if (createErr) {
        log(`channel ${ch.name}: create source failed: ${createErr.message.slice(0, 120)}`);
      } else {
        sourceId = created?.id ?? null;
      }
    }
    if (!sourceId) continue;

    try {
      const messages = await fetchChannelMessages(session, chatCode, 20);
      if (!messages.length) continue;

      // Oldest-first so the cursor can advance monotonically.
      const pending = planNewMessages(messages, ch.last_processed_message_id);

      // Gap detection: if the oldest fetched message is already newer than
      // last_processed + 1, messages between the two were never ingested (the
      // channel produced more than one page between polls). We can't page
      // backwards with this fetch helper, so at least make it visible.
      const oldestFetched = Math.min(...messages.map((m) => m.id));
      if (
        ch.last_processed_message_id != null &&
        oldestFetched > ch.last_processed_message_id + 1
      ) {
        log(
          `channel ${ch.name}: GAP — messages ${ch.last_processed_message_id + 1}..${oldestFetched - 1} missed (increase poll frequency)`,
        );
      }

      // Ingest in order and advance the cursor ONLY past messages that were
      // actually ingested. Previously the cursor jumped to the newest fetched
      // id even when an ingest failed — permanently dropping those signals.
      let newCursor = ch.last_processed_message_id;
      for (const m of pending) {
        const res = await ingestSignalForSource(m.text, sourceId).catch((e: unknown) => {
          log(`channel ${ch.name}: ingest error: ${String(e).slice(0, 120)}`);
          return null;
        });
        if (res == null) break; // leave cursor before this message; retry next tick
        if ((res.queued ?? 0) > 0) ingested += res.queued;
        newCursor = m.id;
      }

      if (newCursor !== ch.last_processed_message_id && newCursor != null) {
        await sb
          .from("personal_signal_channels")
          .update({ last_processed_message_id: newCursor })
          .eq("id", ch.id);
      }
    } catch (e) {
      const msg = String(e);
      const flood = /FLOOD_WAIT_(\d+)/.exec(msg);
      if (flood) {
        const wait = Number(flood[1]);
        log(`channel ${ch.name}: flood wait ${wait}s — skipping this tick`);
      } else {
        log(`channel ${ch.name}: fetch failed: ${msg.slice(0, 140)}`);
      }
    }
  }

  return { checked: targets.length, ingested };
}
