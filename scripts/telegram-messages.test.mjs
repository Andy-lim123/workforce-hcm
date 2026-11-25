import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverMessages, NOTICE_MINUTES, planMessages, readNotice, reportText, signNotice } from "../lib/telegram-messages.ts";

const now = new Date("2026-11-25T02:00:00Z");
const shift = (id, o = {}) => ({
  id, title: `Shift ${id}`, when: `when-${id}`, department: "Support", position: null, status: "published",
  starts_at: "2026-11-26T06:00:00Z", ends_at: "2026-11-26T14:00:00Z",
  assignees: [{ employeeId: "a", firstName: "Ana" }], ...o,
});
const both = [{ employeeId: "a", firstName: "Ana" }, { employeeId: "b", firstName: "Ben" }];

test("a week sends ONE message per employee, listing their shifts in time order", () => {
  const messages = planMessages("week", [
    shift("2", { starts_at: "2026-11-27T06:00:00Z", ends_at: "2026-11-27T14:00:00Z", assignees: both }),
    shift("1"),
    shift("3", { starts_at: "2026-11-28T06:00:00Z", ends_at: "2026-11-28T14:00:00Z" }),
  ], now);
  assert.deepEqual(messages.map((m) => m.employeeId).sort(), ["a", "b"]);
  const ana = messages.find((m) => m.employeeId === "a").text;
  assert.ok(ana.startsWith("Hi Ana, your schedule was published:"));
  assert.ok(ana.indexOf("when-1") < ana.indexOf("when-2") && ana.indexOf("when-2") < ana.indexOf("when-3"));
  const ben = messages.find((m) => m.employeeId === "b").text;
  assert.ok(ben.includes("when-2") && !ben.includes("when-1"));
});

test("only the required saved status is sent: drafts never, except the withdrawal itself", () => {
  const draft = [shift("1", { status: "draft" })];
  for (const event of ["published", "week", "assigned", "changed", "reminder", "cancelled"]) assert.deepEqual(planMessages(event, draft, now), [], event);
  assert.equal(planMessages("withdrawn", draft, now).length, 1);
  assert.deepEqual(planMessages("withdrawn", [shift("1")], now), []); // published again meanwhile
  assert.equal(planMessages("cancelled", [shift("1", { status: "cancelled" })], now).length, 1);
  assert.deepEqual(planMessages("published", [shift("1", { status: "cancelled" })], now), []);
});

test("ended shifts send nothing; an assignment goes only to that employee; a change shows before and after", () => {
  const ended = shift("1", { ends_at: now.toISOString() });
  for (const event of ["published", "changed", "reminder"]) assert.deepEqual(planMessages(event, [ended], now), [], event);
  const assigned = planMessages("assigned", [shift("1", { assignees: both })], now, { onlyEmployees: ["b"] });
  assert.deepEqual(assigned.map((m) => m.employeeId), ["b"]);
  const [changed] = planMessages("changed", [shift("1", { position: "Lead" })], now, { previous: { title: "Old", when: "old-when", department: "Retail", position: null } });
  assert.match(changed.text, /has changed\. It is now:\n• when-1: Shift 1 \(Support, Lead\)\nBefore:\n• old-when: Old \(Retail\)/);
});

test("a very long week stays under Telegram's limit and says how many were left out", () => {
  const many = Array.from({ length: 200 }, (_, i) => shift(String(i).padStart(3, "0"), { title: "A fairly long shift title used for the limit" }));
  const [message] = planMessages("week", many, now);
  assert.ok(message.text.length <= 4096);
  assert.match(message.text, /and \d+ more/);
});

test("delivery: sent, not linked, refused is failed, timeout, network, server error and throws are unknown; one try each", async () => {
  const messages = ["ok", "none", "refused", "timeout", "network", "server", "throws"].map((employeeId) => ({ employeeId, text: employeeId }));
  const chats = new Map(messages.filter((m) => m.employeeId !== "none").map((m, i) => [m.employeeId, i + 1]));
  const calls = [];
  const counts = await deliverMessages(messages, chats, async (_chat, text) => {
    calls.push(text);
    if (text === "ok") return { ok: true, result: {} };
    if (text === "refused") return { ok: false, reason: "rejected", status: 403 };
    if (text === "server") return { ok: false, reason: "rejected", status: 502 };
    if (text === "throws") throw new Error("boom");
    return { ok: false, reason: text };
  }, 3);
  assert.deepEqual(counts, { sent: 1, notLinked: 1, failed: 1, unknown: 4 });
  assert.equal(calls.length, 6);
  assert.equal(new Set(calls).size, 6); // never retried
});

test("report wording separates failed from unknown", () => {
  assert.equal(reportText({ outcome: "done", sent: 1, notLinked: 2, failed: 0, unknown: 1 }), "Telegram: 1 sent, 2 not linked, 0 failed, 1 delivery unknown (not retried).");
  assert.equal(reportText({ outcome: "done", sent: 0, notLinked: 0, failed: 0, unknown: 0 }), "Telegram: nobody needed a message.");
  assert.match(reportText({ outcome: "not_set_up" }), /not set up/);
  assert.match(reportText({ outcome: "not_prepared" }), /none were sent/);
});

test("signed notice: only the untouched value, for its shift, before it expires", () => {
  const notice = { kind: "assigned", report: { outcome: "done", sent: 1, notLinked: 0, failed: 0, unknown: 0 } };
  const value = signNotice("shift-1", notice, "secret", now);
  assert.deepEqual(readNotice(value, "shift-1", "secret", now), notice);
  assert.equal(readNotice(value, "shift-2", "secret", now), null);
  assert.equal(readNotice(value, "shift-1", "other", now), null);
  assert.equal(readNotice(value, "shift-1", "", now), null);
  assert.equal(readNotice(value, "shift-1", "secret", new Date(now.getTime() + NOTICE_MINUTES * 60_000)), null);
  const [body, signature] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ s: "shift-1", e: now.getTime() + 60_000, n: { ...notice, report: { ...notice.report, sent: 99 } } })).toString("base64url");
  for (const bad of [`${forged}.${signature}`, `${body}.AAAA`, body, `${value}.x`, "1.2.0.0", undefined, ["a"]]) assert.equal(readNotice(bad, "shift-1", "secret", now), null);
});
