import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDayHeading, formatTimeRange, toManilaParts } from "@/lib/scheduling";
import { callTelegram } from "@/lib/telegram";
import { deliverMessages, planMessages, type NotifyEvent, type NotifyReport, type NotifyShift, type PreviousShift } from "@/lib/telegram-messages";

// Telegram notifications for schedule changes. SERVER ONLY, and only to be called by an admin action AFTER its write
// succeeded. The schedule is the source of truth: this re-reads the saved shifts, sends at most one message per employee,
// stores nothing, never retries and NEVER throws, so nothing here can fail or undo a scheduling change.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BATCH = 100; // keeps the id lists in one request address

export const shiftWhen = (startsAt: string, endsAt: string) =>
  `${formatDayHeading(toManilaParts(startsAt).date)}, ${formatTimeRange(startsAt, endsAt)} (Manila)`;

export async function notifyShifts(
  supabase: Supabase,
  event: NotifyEvent,
  shiftIds: readonly string[],
  options: { onlyEmployees?: readonly string[]; previous?: PreviousShift } = {},
): Promise<NotifyReport> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const admin = createAdminClient();
    if (!token || !admin) return { outcome: "not_set_up" };

    // Re-read what is actually saved now; planMessages drops anything with the wrong status or already ended.
    const shifts: NotifyShift[] = [];
    for (let i = 0; i < shiftIds.length; i += BATCH) {
      const { data, error } = await supabase
        .from("shifts")
        .select("id, title, starts_at, ends_at, status, department:departments(name), position:positions(title), shift_assignments(employee_id, employee:employees(first_name))")
        .in("id", shiftIds.slice(i, i + BATCH));
      if (error || !data) return { outcome: "not_prepared" };
      shifts.push(
        ...data.map((s) => ({
          id: s.id,
          title: s.title,
          when: shiftWhen(s.starts_at, s.ends_at),
          department: s.department?.name ?? "No department",
          position: s.position?.title ?? null,
          status: s.status,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          assignees: s.shift_assignments.map((a) => ({ employeeId: a.employee_id, firstName: a.employee?.first_name ?? "there" })),
        })),
      );
    }

    const messages = planMessages(event, shifts, new Date(), options);
    if (!messages.length) return { outcome: "done", sent: 0, notLinked: 0, failed: 0, unknown: 0 };

    // Chat ids: secret-key client, only for the people being messaged. They never leave this function.
    const chatIds = new Map<string, number>();
    const ids = messages.map((m) => m.employeeId);
    for (let i = 0; i < ids.length; i += BATCH) {
      const { data, error } = await admin.from("employee_telegram").select("employee_id, chat_id").in("employee_id", ids.slice(i, i + BATCH));
      if (error || !data) return { outcome: "not_prepared" };
      for (const row of data) chatIds.set(row.employee_id, row.chat_id);
    }

    const counts = await deliverMessages(messages, chatIds, (chatId, text) => callTelegram(token, "sendMessage", { chat_id: chatId, text }));
    return { outcome: "done", ...counts };
  } catch {
    // Deliberately silent about the cause: raw errors can contain the request address, which holds the bot token.
    return { outcome: "not_prepared" };
  }
}
