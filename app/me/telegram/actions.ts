"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LINK_CODE_MINUTES, callTelegram, createLinkCode, findLinkChat, type TelegramUpdate } from "@/lib/telegram";
import type { ActionState } from "@/components/action-form";

// Linking the signed-in employee's own Telegram account. No action takes an employee id or a chat id from the browser:
// the employee comes from the session, the chat id only from Telegram. The secret-key client is used for one thing here,
// creating the link after the chat has proved it holds this employee's signed code (RLS gives sessions no insert).
// No message is sent and no chat id is ever returned to the page.

const NOT_SET_UP = "Telegram is not set up yet. Ask your administrator.";
const UNREACHABLE = "Could not reach Telegram. Please try again in a moment.";

/** The signed-in employee, their session client and whether they already have a link. */
async function currentEmployee() {
  const user = await requireRole("employee");
  const supabase = await createClient();
  const { data: me, error } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (error) return { error: "Could not load your account. Please try again." } as const;
  if (!me) return { error: "Your account is not linked to an employee record yet. Ask your administrator." } as const;
  const { data: link, error: linkError } = await supabase.from("employee_telegram").select("employee_id").eq("employee_id", me.id).maybeSingle();
  if (linkError) return { error: "Could not check your Telegram connection. Please try again." } as const;
  return { supabase, employeeId: me.id, linked: Boolean(link) } as const;
}

export async function startTelegramLink(): Promise<ActionState> {
  const me = await currentEmployee();
  if ("error" in me) return { error: me.error };
  if (me.linked) return { error: "Telegram is already connected. Disconnect it first to use another account." };

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !createAdminClient()) return { error: NOT_SET_UP };
  const bot = await callTelegram<{ username?: string }>(token, "getMe");
  if (!bot.ok) return { error: bot.reason === "rejected" ? NOT_SET_UP : UNREACHABLE };
  if (!bot.result.username) return { error: NOT_SET_UP };

  const code = createLinkCode(me.employeeId, token, new Date());
  return {
    success: `Open the link, press Start in Telegram, then come back and press Check connection. The link works for ${LINK_CODE_MINUTES} minutes. Do not share it.`,
    link: `https://t.me/${bot.result.username}?start=${code}`,
  };
}

export async function checkTelegramLink(prev: ActionState): Promise<ActionState> {
  const me = await currentEmployee();
  if ("error" in me) return { error: me.error };
  if (me.linked) {
    refresh();
    return { success: "Telegram is connected.", done: (prev.done ?? 0) + 1 };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = createAdminClient();
  if (!token || !admin) return { error: NOT_SET_UP };
  // offset -100 reads the newest 100 messages to the bot. shortcut: enough for a small team; use a webhook beyond that.
  const updates = await callTelegram<TelegramUpdate[]>(token, "getUpdates", { offset: -100, limit: 100, allowed_updates: ["message"] });
  if (!updates.ok) return { error: updates.reason === "rejected" ? NOT_SET_UP : UNREACHABLE };

  const match = findLinkChat(updates.result, me.employeeId, token, new Date());
  if (!match.ok) {
    if (match.reason === "expired") return { error: "That link has expired. Press Connect Telegram for a new one." };
    if (match.reason === "ambiguous")
      return { error: "This link was used from more than one Telegram account, so nothing was connected. Wait until it expires, then try a new link." };
    return { error: "No Start message found yet. Open your link, press Start in Telegram, then check again." };
  }

  const { error } = await admin.from("employee_telegram").insert({ employee_id: me.employeeId, chat_id: match.chatId });
  if (error) {
    if (error.code === "23505") return { error: "That Telegram account is already connected to an employee. Nothing was changed." };
    return { error: "Could not save the connection. Please try again." };
  }
  refresh();
  return { success: "Telegram is connected.", done: (prev.done ?? 0) + 1 };
}

export async function unlinkTelegram(prev: ActionState): Promise<ActionState> {
  const me = await currentEmployee();
  if ("error" in me) return { error: me.error };
  // The employee's own session: row-level security allows removing only their own link. No columns are returned.
  const { error } = await me.supabase.from("employee_telegram").delete().eq("employee_id", me.employeeId);
  if (error) return { error: "Could not disconnect Telegram. Please try again." };
  refresh();
  return { success: "Telegram is disconnected.", done: (prev.done ?? 0) + 1 };
}
