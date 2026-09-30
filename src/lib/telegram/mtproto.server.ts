// Server-only MTProto wrapper around gramjs.
// Each call spins up a fresh client, performs one action, then disconnects.
//
// Requires env: TELEGRAM_API_ID, TELEGRAM_API_HASH.

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

function getCreds() {
  const apiIdRaw = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiIdRaw || !apiHash) {
    throw new Error("Telegram is not configured (missing API id/hash)");
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId)) throw new Error("TELEGRAM_API_ID must be a number");
  return { apiId, apiHash };
}

async function makeClient(sessionString = "") {
  const { apiId, apiHash } = getCreds();
  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 2,
    useWSS: true,
    deviceModel: "AI TRED AGENT",
    appVersion: "1.0",
    systemVersion: "web",
  });
  await client.connect();
  return client;
}

export type SendCodeResult = {
  sessionString: string;
  phoneCodeHash: string;
};

/** Step 1: ask Telegram to dispatch a login code to the user. */
export async function sendLoginCode(phone: string): Promise<SendCodeResult> {
  const { apiId, apiHash } = getCreds();
  const client = await makeClient("");
  try {
    const result = await client.sendCode({ apiId, apiHash }, phone);
    return {
      sessionString: (client.session.save() as unknown as string) ?? "",
      phoneCodeHash: result.phoneCodeHash,
    };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export type VerifyResult =
  | {
      kind: "ok";
      sessionString: string;
      userId: string;
      username: string | null;
      firstName: string | null;
    }
  | { kind: "needs_password"; sessionString: string };

/** Step 2: submit the code. May indicate that a 2FA password is required. */
export async function verifyLoginCode(args: {
  partialSession: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<VerifyResult> {
  const client = await makeClient(args.partialSession);
  try {
    try {
      const result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: args.phone,
          phoneCodeHash: args.phoneCodeHash,
          phoneCode: args.code,
        }),
      );
      const user = "user" in result ? (result.user as Api.User) : null;
      return {
        kind: "ok",
        sessionString: (client.session.save() as unknown as string) ?? "",
        userId: user?.id?.toString() ?? "",
        username: user?.username ?? null,
        firstName: user?.firstName ?? null,
      };
    } catch (err: unknown) {
      const msg: string =
        (err as { errorMessage?: string })?.errorMessage ??
        (err as { message?: string })?.message ??
        "";
      if (msg === "SESSION_PASSWORD_NEEDED") {
        return {
          kind: "needs_password",
          sessionString: (client.session.save() as unknown as string) ?? "",
        };
      }
      throw err;
    }
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Step 2b: 2FA cloud password. */
export async function verifyLoginPassword(args: {
  partialSession: string;
  password: string;
}): Promise<Extract<VerifyResult, { kind: "ok" }>> {
  const client = await makeClient(args.partialSession);
  try {
    await client.signInWithPassword(
      { apiId: getCreds().apiId, apiHash: getCreds().apiHash },
      {
        password: async () => args.password,
        onError: (e) => {
          throw e;
        },
      },
    );
    const me = (await client.getMe()) as Api.User;
    return {
      kind: "ok",
      sessionString: (client.session.save() as unknown as string) ?? "",
      userId: me?.id?.toString() ?? "",
      username: me?.username ?? null,
      firstName: me?.firstName ?? null,
    };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Log out a stored session (best-effort). */
export async function logOutSession(sessionString: string): Promise<void> {
  if (!sessionString) return;
  try {
    const client = await makeClient(sessionString);
    try {
      await client.invoke(new Api.auth.LogOut());
    } finally {
      await client.disconnect().catch(() => {});
    }
  } catch {
    // Ignore — best effort.
  }
}

// ============ QR / approve-based login (login-token flow) ============
// Instead of phone -> code -> 2FA, the owner scans the QR (or opens the
// tg://login link) in their already-authorized Telegram and taps Approve.
// The server polls ExportLoginToken until the approval lands.

const qrSessions = new Map<string, { client: TelegramClient; token: Buffer; expiresAt: number }>();
const QR_SESSION_TTL_MS = 3 * 60 * 1000; // 3 minutes

export type QrLoginStartResult = {
  loginToken: string; // base64url token — put it in tg://login?token=...
  expires: number;
};

function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  return Buffer.from(v as Uint8Array);
}

/** Step 1 (QR): open a client and export a login token. Keeps the client alive for polling. */
export async function startQrLogin(sessionId: string): Promise<QrLoginStartResult> {
  const { apiId, apiHash } = getCreds();
  const client = await makeClient("");
  try {
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
    );
    if (!(result instanceof Api.auth.LoginToken)) {
      throw new Error("Unexpected result while creating the login QR");
    }
    const token = toBuffer(result.token);
    qrSessions.set(sessionId, {
      client,
      token,
      expiresAt: Date.now() + QR_SESSION_TTL_MS,
    });
    // Abandoned approval dialogs must release their live MTProto connection.
    const expiry = setTimeout(() => {
      if (qrSessions.get(sessionId)?.client !== client) return;
      qrSessions.delete(sessionId);
      void client.disconnect().catch(() => {});
    }, QR_SESSION_TTL_MS);
    expiry.unref();
    return { loginToken: token.toString("base64url"), expires: Number(result.expires) };
  } catch (err) {
    await client.disconnect().catch(() => {});
    throw err;
  }
}

/**
 * Step 2 (QR): poll for approval.
 * Returns null while the owner has not approved yet.
 */
export async function pollQrLogin(sessionId: string): Promise<VerifyResult | null> {
  const sess = qrSessions.get(sessionId);
  if (!sess) throw new Error("QR login session expired. Please start again.");
  if (Date.now() > sess.expiresAt) {
    qrSessions.delete(sessionId);
    await sess.client.disconnect().catch(() => {});
    throw new Error("QR login expired. Please start again.");
  }
  const { apiId, apiHash } = getCreds();
  try {
    const result = await sess.client.invoke(
      new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
    );
    if (result instanceof Api.auth.LoginTokenSuccess) {
      const auth = result.authorization;
      const user = auth instanceof Api.auth.Authorization ? (auth.user as Api.User) : null;
      const sessionString = (sess.client.session.save() as unknown as string) ?? "";
      qrSessions.delete(sessionId);
      await sess.client.disconnect().catch(() => {});
      return {
        kind: "ok",
        sessionString,
        userId: user?.id?.toString() ?? "",
        username: user?.username ?? null,
        firstName: user?.firstName ?? null,
      };
    }
    if (result instanceof Api.auth.LoginTokenMigrateTo) {
      await sess.client._switchDC(result.dcId);
      const migrated = await sess.client.invoke(
        new Api.auth.ImportLoginToken({ token: toBuffer(result.token) }),
      );
      if (migrated instanceof Api.auth.LoginTokenSuccess) {
        const auth = migrated.authorization;
        const user = auth instanceof Api.auth.Authorization ? (auth.user as Api.User) : null;
        const sessionString = (sess.client.session.save() as unknown as string) ?? "";
        qrSessions.delete(sessionId);
        await sess.client.disconnect().catch(() => {});
        return {
          kind: "ok",
          sessionString,
          userId: user?.id?.toString() ?? "",
          username: user?.username ?? null,
          firstName: user?.firstName ?? null,
        };
      }
      return null;
    }
    if (result instanceof Api.auth.LoginToken) {
      // Not approved yet — refresh the token (QR rotates).
      sess.token = toBuffer(result.token);
      return null;
    }
    return null;
  } catch (err: unknown) {
    const msg: string =
      (err as { errorMessage?: string })?.errorMessage ??
      (err as { message?: string })?.message ??
      "";
    if (msg === "SESSION_PASSWORD_NEEDED") {
      const sessionString = (sess.client.session.save() as unknown as string) ?? "";
      qrSessions.delete(sessionId);
      await sess.client.disconnect().catch(() => {});
      return { kind: "needs_password", sessionString };
    }
    throw err;
  }
}

/** Cancel an in-flight QR login (best effort). */
export async function cancelQrLogin(sessionId: string): Promise<void> {
  const sess = qrSessions.get(sessionId);
  if (!sess) return;
  qrSessions.delete(sessionId);
  await sess.client.disconnect().catch(() => {});
}

export type DialogChannel = {
  chatId: string;
  name: string;
  username: string | null;
  isBroadcast: boolean;
  participantsCount: number | null;
};

/** List the user's subscribed channels, supergroups & groups via MTProto. */
export async function listDialogChannels(sessionString: string): Promise<DialogChannel[]> {
  const client = await makeClient(sessionString);
  const out: DialogChannel[] = [];
  const seen = new Set<string>();
  try {
    const dialogs = await client.getDialogs({ limit: 1000, archived: false });
    for (const d of dialogs) {
      const e = d.entity as {
        className?: string;
        id?: { toString(): string };
        title?: string;
        username?: string | null;
        broadcast?: boolean;
        participantsCount?: number;
      } | null;
      if (!e) continue;
      // Include Channels (broadcast + supergroups) and basic Chats (small groups).
      // Skip Users (1-on-1 DMs) — those are not signal sources.
      const cls = e.className;
      if (cls !== "Channel" && cls !== "Chat") continue;
      const chatId = e.id?.toString() ?? "";
      if (!chatId || seen.has(chatId)) continue;
      seen.add(chatId);
      out.push({
        chatId,
        name: e.title ?? "(untitled)",
        username: e.username ?? null,
        isBroadcast: !!e.broadcast,
        participantsCount: typeof e.participantsCount === "number" ? e.participantsCount : null,
      });
    }
  } finally {
    await client.disconnect().catch(() => {});
  }
  return out;
}

/** Translate raw gramjs errors into user-friendly messages. */
export function friendlyTelegramError(err: unknown): string {
  const asRecord = err as { errorMessage?: string; message?: string } | null;
  const raw = asRecord?.errorMessage ?? asRecord?.message ?? String(err);
  const map: Record<string, string> = {
    PHONE_CODE_INVALID: "That code is incorrect. Please try again.",
    PHONE_CODE_EXPIRED: "That code has expired. Please resend a new one.",
    PHONE_NUMBER_INVALID: "That phone number is not valid.",
    PHONE_NUMBER_BANNED: "This phone number has been banned by Telegram.",
    PASSWORD_HASH_INVALID: "Incorrect 2FA password.",
    AUTH_RESTART: "Login was interrupted. Please start again.",
  };
  if (map[raw]) return map[raw];
  const flood = /^FLOOD_WAIT_(\d+)$/.exec(raw);
  if (flood) {
    const secs = Number(flood[1]);
    const mins = Math.ceil(secs / 60);
    return `Telegram is rate-limiting this number. Try again in ${secs < 60 ? `${secs}s` : `${mins} min`}.`;
  }
  return raw || "Telegram login failed.";
}

export type ChannelMessage = {
  id: number;
  text: string;
  date: number; // epoch ms
};

/**
 * Fetch recent messages from a channel/supergroup via the user's own session
 * (NO bot required — works because the linked account is a member).
 * Returns text messages newest-first, capped at `limit` (default 20).
 * Throws on flood/network errors so the caller can back off.
 */
export async function fetchChannelMessages(
  sessionString: string,
  chatId: string,
  limit = 20,
): Promise<ChannelMessage[]> {
  const client = await makeClient(sessionString);
  try {
    const entity = await client.getEntity(chatId);
    const messages = await client.getMessages(entity, { limit });
    const out: ChannelMessage[] = [];
    for (const m of messages) {
      const text = m.text?.trim();
      if (!text) continue; // skip media-only, stickers, etc.
      const dateMs = m.date ? Number(m.date) * 1000 : Date.now();
      out.push({ id: m.id, text, date: dateMs });
    }
    return out;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

// Bot-less notification delivery — send a message to a chat using the
// USER'S OWN MTProto session (no bot, no bot token). Works because the
// linked Telegram account is a member of the target chat.
export async function sendMessageTelegram(
  sessionString: string,
  chatId: string,
  text: string,
): Promise<void> {
  const client = await makeClient(sessionString);
  try {
    const entity = await client.getEntity(chatId);
    // gramjs sanitizeParseMode accepts lowercase "html" (or md/markdown); "HTML" throws
    // "Invalid parse mode type HTML". Use the lowercase form the parser expects.
    await client.sendMessage(entity, { message: text, parseMode: "html" });
  } finally {
    await client.disconnect().catch(() => {});
  }
}
