// What to send, to whom, and how the outcome is counted. Pure apart from node:crypto (the signed result notice), with no
// runtime project imports, so the unit tests run it directly. SERVER ONLY (it is given the signing secret).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramResult } from "./telegram";

export type NotifyEvent = "published" | "week" | "assigned" | "changed" | "withdrawn" | "cancelled" | "reminder";

/** The status a shift must have, as re-read AFTER the write, for the event to be sent. */
export const REQUIRED_STATUS: Record<NotifyEvent, "published" | "draft" | "cancelled"> = {
  published: "published",
  week: "published",
  assigned: "published",
  changed: "published",
  reminder: "published",
  withdrawn: "draft", // the one message about a draft: a published shift was just withdrawn
  cancelled: "cancelled",
};

export type NotifyShift = {
  id: string;
  title: string;
  /** Already formatted for the reader, for example "Thu 26 Nov, 14:00–22:00". */
  when: string;
  department: string;
  position: string | null;
  status: "draft" | "published" | "cancelled";
  starts_at: string;
  ends_at: string;
  assignees: { employeeId: string; firstName: string }[];
};

export type PreviousShift = Pick<NotifyShift, "title" | "when" | "department" | "position">;

export type OutgoingMessage = { employeeId: string; text: string };

const MAX_LENGTH = 4000; // Telegram's limit is 4096

const line = (s: PreviousShift) => `• ${s.when}: ${s.title} (${s.department}${s.position ? `, ${s.position}` : ""})`;

const INTRO: Record<NotifyEvent, string> = {
  published: "a shift was published for you:",
  week: "your schedule was published:",
  assigned: "you were added to a published shift:",
  changed: "a shift you are on has changed. It is now:",
  withdrawn: "this shift was withdrawn. Do not work it unless it is published again:",
  cancelled: "this shift was cancelled:",
  reminder: "a reminder of your shift(s) tomorrow:",
};

/**
 * At most ONE message per employee, listing all of that employee's shifts. A shift is left out unless it has the status the
 * event requires and has not ended. `onlyEmployees` limits the recipients (for an assignment).
 */
export function planMessages(
  event: NotifyEvent,
  shifts: readonly NotifyShift[],
  now: Date,
  options: { onlyEmployees?: readonly string[]; previous?: PreviousShift } = {},
): OutgoingMessage[] {
  const people = new Map<string, { firstName: string; shifts: NotifyShift[] }>();
  const live = shifts
    .filter((s) => s.status === REQUIRED_STATUS[event] && Date.parse(s.ends_at) > now.getTime())
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
  for (const shift of live) {
    for (const person of shift.assignees) {
      if (options.onlyEmployees && !options.onlyEmployees.includes(person.employeeId)) continue;
      const entry = people.get(person.employeeId) ?? { firstName: person.firstName, shifts: [] };
      if (!entry.shifts.includes(shift)) entry.shifts.push(shift);
      people.set(person.employeeId, entry);
    }
  }
  return [...people].map(([employeeId, { firstName, shifts: own }]) => {
    let text = `Hi ${firstName}, ${INTRO[event]}`;
    const before = event === "changed" && options.previous ? `\nBefore:\n${line(options.previous)}` : "";
    for (let i = 0; i < own.length; i++) {
      const next = `\n${line(own[i])}`;
      if (text.length + next.length + before.length > MAX_LENGTH - 80) {
        text += `\n…and ${own.length - i} more. Open your schedule to see them.`;
        break;
      }
      text += next;
    }
    return { employeeId, text: (text + before).slice(0, MAX_LENGTH) };
  });
}

export type DeliveryCounts = { sent: number; notLinked: number; failed: number; unknown: number };

export type NotifyReport =
  | ({ outcome: "done" } & DeliveryCounts)
  /** No bot token or secret key: nothing was attempted. */
  | { outcome: "not_set_up" }
  /** The data needed to build or address the messages could not be read: nothing was sent. */
  | { outcome: "not_prepared" };

/**
 * Sends each message once. NEVER retries and NEVER throws. A clear refusal by Telegram (HTTP 4xx) is "failed"; a timeout,
 * a network error or a server error is "unknown", because Telegram may already have delivered the message.
 */
export async function deliverMessages(
  messages: readonly OutgoingMessage[],
  chatIds: ReadonlyMap<string, number>,
  send: (chatId: number, text: string) => Promise<TelegramResult<unknown>>,
  concurrency = 5,
): Promise<DeliveryCounts> {
  const counts: DeliveryCounts = { sent: 0, notLinked: 0, failed: 0, unknown: 0 };
  for (let i = 0; i < messages.length; i += concurrency) {
    await Promise.all(
      messages.slice(i, i + concurrency).map(async (message) => {
        const chatId = chatIds.get(message.employeeId);
        if (chatId === undefined) {
          counts.notLinked++;
          return;
        }
        try {
          const result = await send(chatId, message.text);
          if (result.ok) counts.sent++;
          else if (result.reason === "rejected" && result.status !== undefined && result.status >= 400 && result.status < 500) counts.failed++;
          else counts.unknown++;
        } catch {
          counts.unknown++;
        }
      }),
    );
  }
  return counts;
}

export function reportText(report: NotifyReport): string {
  if (report.outcome === "not_set_up") return "Telegram is not set up, so no messages were sent.";
  if (report.outcome === "not_prepared") return "Telegram messages could not be prepared, so none were sent.";
  const { sent, notLinked, failed, unknown } = report;
  if (sent + notLinked + failed + unknown === 0) return "Telegram: nobody needed a message.";
  return `Telegram: ${sent} sent, ${notLinked} not linked, ${failed} failed, ${unknown} delivery unknown${unknown ? " (not retried)" : ""}.`;
}

// --- Signed result notice -------------------------------------------------------------------------------------------
// Assigning and cancelling remove the part of the page that would show the result, so the action redirects with it. The
// value is signed by the server and bound to the shift and a short expiry: an edited or reused address shows nothing.

export const NOTICE_MINUTES = 5;
export type NoticeKind = "assigned" | "cancelled";
export type Notice = { kind: NoticeKind; report: NotifyReport };

const mac = (data: string, secret: string) =>
  createHmac("sha256", createHmac("sha256", secret).update("wms-telegram-notice-v1").digest()).update(data).digest();

export function signNotice(shiftId: string, notice: Notice, secret: string, now: Date): string {
  const body = Buffer.from(JSON.stringify({ s: shiftId, e: now.getTime() + NOTICE_MINUTES * 60_000, n: notice })).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

export function readNotice(value: unknown, shiftId: string, secret: string, now: Date): Notice | null {
  if (typeof value !== "string" || !secret || value.length > 600) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { s: string; e: number; n: Notice };
    return data.s === shiftId && data.e > now.getTime() ? data.n : null;
  } catch {
    return null;
  }
}
