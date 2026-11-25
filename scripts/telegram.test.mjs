import { test } from "node:test";
import assert from "node:assert/strict";
import { callTelegram, createLinkCode, findLinkChat, LINK_CODE_MINUTES, verifyLinkCode } from "../lib/telegram.ts";

const TOKEN = "123456:unit-test-token-not-real";
const A = "f07991d7-becb-4e04-8688-8b7ca577f65f";
const B = "11111111-2222-4333-8444-555555555555";
const now = new Date("2026-11-25T02:00:00Z");
const later = (minutes) => new Date(now.getTime() + minutes * 60_000);
const start = (code, id = 42, o = {}) => ({ message: { text: `/start ${code}`, chat: { id, type: "private" }, from: { id, is_bot: false }, ...o } });

test("link code: fits Telegram's start parameter and verifies for its employee only until it expires", () => {
  const code = createLinkCode(A, TOKEN, now);
  assert.match(code, /^[A-Za-z0-9_-]{48}$/);
  assert.deepEqual(verifyLinkCode(code, TOKEN, later(LINK_CODE_MINUTES - 1)), { ok: true, employeeId: A });
  assert.deepEqual(verifyLinkCode(code, TOKEN, later(LINK_CODE_MINUTES)), { ok: false, reason: "expired" });
  assert.notEqual(createLinkCode(B, TOKEN, now), code);
});

test("link code: altered, truncated, foreign-token and garbage codes are invalid", () => {
  const code = createLinkCode(A, TOKEN, now);
  for (let i = 0; i < code.length; i++) {
    const changed = code.slice(0, i) + (code[i] === "A" ? "B" : "A") + code.slice(i + 1);
    assert.equal(verifyLinkCode(changed, TOKEN, now).ok, false, `position ${i}`);
  }
  for (const bad of [code.slice(1), `${code}A`, "", "x".repeat(48), "../../etc"]) assert.equal(verifyLinkCode(bad, TOKEN, now).ok, false);
  assert.equal(verifyLinkCode(code, "999:other-token", now).ok, false);
  assert.equal(verifyLinkCode(code, "", now).ok, false);
  assert.throws(() => createLinkCode("not-a-uuid", TOKEN, now));
});

test("findLinkChat: one private chat with this employee's valid code", () => {
  const code = createLinkCode(A, TOKEN, now);
  assert.deepEqual(findLinkChat([{}, { message: { text: "hello" } }, start(code)], A, TOKEN, now), { ok: true, chatId: 42 });
  assert.deepEqual(findLinkChat([start(code), start(code)], A, TOKEN, now), { ok: true, chatId: 42 }); // same chat twice
  assert.deepEqual(findLinkChat([start(code, 7, { text: `/start@wms_bot ${code}` })], A, TOKEN, now), { ok: true, chatId: 7 });
});

test("findLinkChat: refuses other employees, groups, bots, spoofed senders, two chats and expired codes", () => {
  const code = createLinkCode(A, TOKEN, now);
  const notFound = { ok: false, reason: "not_found" };
  assert.deepEqual(findLinkChat([start(code)], B, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([start(code, -100, { chat: { id: -100, type: "group" } })], A, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([start(code, 42, { from: { id: 43, is_bot: false } })], A, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([start(code, 42, { from: { id: 42, is_bot: true } })], A, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([start(code, 42, { text: code })], A, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([], A, TOKEN, now), notFound);
  assert.deepEqual(findLinkChat([start(code, 42), start(code, 43)], A, TOKEN, now), { ok: false, reason: "ambiguous" });
  assert.deepEqual(findLinkChat([start(code)], A, TOKEN, later(11)), { ok: false, reason: "expired" });
  assert.deepEqual(findLinkChat([start(code)], B, TOKEN, later(11)), notFound); // someone else's expired code says nothing
});

test("callTelegram: success, rejection, timeout and network failure, never leaking the token", async () => {
  const ok = await callTelegram(TOKEN, "getMe", {}, async () => new Response(JSON.stringify({ ok: true, result: { username: "wms_bot" } })));
  assert.deepEqual(ok, { ok: true, result: { username: "wms_bot" } });
  const rejected = await callTelegram(TOKEN, "getMe", {}, async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
  assert.deepEqual(rejected, { ok: false, reason: "rejected", status: 401 });
  const timeout = await callTelegram(TOKEN, "getMe", {}, async () => { throw Object.assign(new Error(`timed out ${TOKEN}`), { name: "TimeoutError" }); });
  assert.deepEqual(timeout, { ok: false, reason: "timeout" });
  const network = await callTelegram(TOKEN, "getUpdates", {}, async (url) => { throw new Error(`cannot reach ${url}`); });
  assert.deepEqual(network, { ok: false, reason: "network" });
  for (const result of [rejected, timeout, network]) assert.ok(!JSON.stringify(result).includes(TOKEN));
});
