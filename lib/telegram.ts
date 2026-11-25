// Telegram account linking: signed codes, matching the /start message, and a small Bot API client.
// SERVER ONLY: every function that needs the bot token takes it as an argument; import this from Server Components and
// Server Actions, never from a "use client" file. No project imports, so the unit tests run it directly.
import { createHmac, timingSafeEqual } from "node:crypto";

export const LINK_CODE_MINUTES = 10;

// code = base64url(employee id (16 bytes) + expiry in seconds (4 bytes) + HMAC (16 bytes)) = 48 characters.
// Telegram accepts at most 64 characters of A-Z a-z 0-9 _ - after /start.
const CODE = /^[A-Za-z0-9_-]{48}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sign = (payload: Buffer, botToken: string) => {
  const key = createHmac("sha256", botToken).update("wms-telegram-link-v1").digest();
  return createHmac("sha256", key).update(payload).digest().subarray(0, 16);
};

export function createLinkCode(employeeId: string, botToken: string, now: Date): string {
  if (!UUID.test(employeeId) || !botToken) throw new Error("A valid employee id and bot token are required.");
  const payload = Buffer.alloc(20);
  Buffer.from(employeeId.replaceAll("-", ""), "hex").copy(payload, 0);
  payload.writeUInt32BE(Math.floor(now.getTime() / 1000) + LINK_CODE_MINUTES * 60, 16);
  return Buffer.concat([payload, sign(payload, botToken)]).toString("base64url");
}

export type LinkCodeCheck = { ok: true; employeeId: string } | { ok: false; reason: "invalid" | "expired" };

export function verifyLinkCode(code: string, botToken: string, now: Date): LinkCodeCheck {
  if (!CODE.test(code) || !botToken) return { ok: false, reason: "invalid" };
  const bytes = Buffer.from(code, "base64url");
  const payload = bytes.subarray(0, 20);
  if (!timingSafeEqual(bytes.subarray(20), sign(payload, botToken))) return { ok: false, reason: "invalid" };
  if (payload.readUInt32BE(16) * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  const h = payload.subarray(0, 16).toString("hex");
  return { ok: true, employeeId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}

export type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number; type?: string }; from?: { id?: number; is_bot?: boolean } };
};

export type LinkMatch = { ok: true; chatId: number } | { ok: false; reason: "not_found" | "expired" | "ambiguous" };

/**
 * The private chat that sent this employee's valid code. Only a person writing to the bot from their own private chat
 * counts. If the same employee's code arrived from more than one chat, nothing is linked.
 */
export function findLinkChat(updates: readonly TelegramUpdate[], employeeId: string, botToken: string, now: Date): LinkMatch {
  const chats = new Set<number>();
  let expired = false;
  for (const { message } of updates) {
    const code = message?.text?.match(/^\/start(?:@\w+)?\s+(\S+)\s*$/)?.[1];
    const id = message?.chat?.id;
    if (!code || message?.chat?.type !== "private" || message.from?.is_bot || message.from?.id !== id) continue;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) continue;
    const check = verifyLinkCode(code, botToken, now);
    if (check.ok && check.employeeId === employeeId.toLowerCase()) chats.add(id);
    else if (!check.ok && check.reason === "expired") {
      // Only report "expired" for this employee's own code: re-check it as of long ago.
      const old = verifyLinkCode(code, botToken, new Date(0));
      if (old.ok && old.employeeId === employeeId.toLowerCase()) expired = true;
    }
  }
  if (chats.size > 1) return { ok: false, reason: "ambiguous" };
  const [chatId] = chats;
  return chatId ? { ok: true, chatId } : { ok: false, reason: expired ? "expired" : "not_found" };
}

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; reason: "timeout" | "network" | "rejected"; status?: number };

/**
 * One Bot API call. No retry. The request address contains the token, so neither the address nor any raw error is
 * returned or logged.
 */
export async function callTelegram<T>(
  botToken: string,
  method: "getMe" | "getUpdates" | "sendMessage",
  body: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult<T>> {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
    if (!response.ok || !data?.ok) return { ok: false, reason: "rejected", status: response.status };
    return { ok: true, result: data.result as T };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
