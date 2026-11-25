import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApiKey, MAX_LIMIT, parseQuery } from "../lib/hrms.ts";

const KEY = "unit-test-key-not-real-0123456789abcdef";
const q = (resource, text) => parseQuery(resource, new URLSearchParams(text));

test("API key: only a correct Bearer key; short or missing configuration switches the API off", () => {
  assert.equal(checkApiKey(`Bearer ${KEY}`, KEY), "ok");
  assert.equal(checkApiKey(`bearer ${KEY}`, KEY), "ok");
  for (const header of [null, "", KEY, `Basic ${KEY}`, "Bearer ", `Bearer ${KEY} extra`, `Bearer ${KEY}x`, `Bearer ${KEY.slice(0, -1)}`, `Bearer ${KEY.toUpperCase()}`])
    assert.equal(checkApiKey(header, KEY), "unauthorized", String(header));
  for (const configured of [undefined, "", "short-key", "a".repeat(31)]) assert.equal(checkApiKey(`Bearer ${configured}`, configured), "disabled");
});

test("parameters: defaults, valid values", () => {
  assert.deepEqual(q("employees", ""), { ok: true, query: { limit: 100, offset: 0 } });
  assert.deepEqual(q("employees", "status=on_leave&limit=500&offset=7").query, { limit: 500, offset: 7, status: "on_leave" });
  assert.equal(q("employees", "updated_since=2026-11-25T08:00:00%2B08:00").query.updatedSince, "2026-11-25T00:00:00.000Z");
  assert.deepEqual(q("shifts", "from=2026-11-01&to=2026-12-01").query, { limit: 100, offset: 0, from: "2026-11-01", to: "2026-12-01" }); // 31 days
  assert.equal(q("attendance", "from=2026-11-16&to=2026-11-16").ok, true);
  assert.equal(q("departments", "").ok, true);
});

test("parameters: unknown, repeated, out of range and malformed values are refused", () => {
  const bad = [
    ["employees", "api_key=x"], ["employees", "limit=0"], ["employees", `limit=${MAX_LIMIT + 1}`], ["employees", "limit=ten"], ["employees", "limit=1.5"],
    ["employees", "offset=-1"], ["employees", "limit=1&limit=2"], ["employees", "status=retired"], ["employees", "from=2026-11-01"],
    ["employees", "updated_since=2026-11-25"], ["employees", "updated_since=2026-11-25T00:00:00"], ["employees", "updated_since=2026-02-30T00:00:00Z"],
    ["departments", "limit=1"], ["shifts", ""], ["shifts", "from=2026-11-01"], ["shifts", "from=2026-11-02&to=2026-11-01"],
    ["shifts", "from=2026-11-01&to=2026-12-02"], ["attendance", "from=2026-02-30&to=2026-03-01"], ["attendance", "from=today&to=tomorrow"],
    ["shifts", "from=2026-11-01&to=2026-11-02&status=draft"],
  ];
  for (const [resource, text] of bad) assert.equal(q(resource, text).ok, false, `${resource}?${text}`);
});
