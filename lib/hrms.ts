// Rules of the read-only HRMS API (HRMS_API.md): key check and query parameters. Pure apart from node:crypto, no project
// imports, so the unit tests run it directly. SERVER ONLY.
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_KEY_LENGTH = 32;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
export const MAX_RANGE_DAYS = 31;

export type KeyVerdict = "ok" | "unauthorized" | "disabled";

/** The key is accepted only as `Authorization: Bearer <key>`. Without a long enough configured key the API is off. */
export function checkApiKey(authorization: string | null, configured: string | undefined): KeyVerdict {
  if (!configured || configured.length < MIN_KEY_LENGTH) return "disabled";
  const given = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!given) return "unauthorized";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(configured)) ? "ok" : "unauthorized";
}

export type Resource = "employees" | "departments" | "shifts" | "attendance";

export type HrmsQuery = {
  limit: number;
  offset: number;
  status?: "active" | "on_leave" | "inactive";
  updatedSince?: string;
  from?: string;
  to?: string;
};

const ALLOWED: Record<Resource, readonly string[]> = {
  employees: ["status", "updated_since", "limit", "offset"],
  departments: [],
  shifts: ["from", "to", "limit", "offset"],
  attendance: ["from", "to", "limit", "offset"],
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

/** Every parameter is validated; anything unknown, repeated or out of range is refused, never silently adjusted. */
export function parseQuery(resource: Resource, params: URLSearchParams): { ok: true; query: HrmsQuery } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  for (const key of new Set(params.keys())) {
    if (!ALLOWED[resource].includes(key)) return fail(`Unknown parameter "${key.slice(0, 40)}".`);
    if (params.getAll(key).length > 1) return fail(`Parameter "${key}" is given more than once.`);
  }

  const query: HrmsQuery = { limit: DEFAULT_LIMIT, offset: 0 };
  for (const key of ["limit", "offset"] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = /^\d{1,7}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(value) || (key === "limit" && (value < 1 || value > MAX_LIMIT)))
      return fail(key === "limit" ? `limit must be a whole number from 1 to ${MAX_LIMIT}.` : "offset must be a whole number, 0 or more.");
    query[key] = value;
  }

  const status = params.get("status");
  if (status !== null) {
    if (status !== "active" && status !== "on_leave" && status !== "inactive") return fail("status must be active, on_leave or inactive.");
    query.status = status;
  }

  const since = params.get("updated_since");
  if (since !== null) {
    const day = since.match(TIMESTAMP)?.[1];
    if (!day || !isDate(day)) return fail('updated_since must be a timestamp with a zone, for example 2026-11-25T00:00:00Z (write "+" as %2B).');
    query.updatedSince = new Date(since).toISOString();
  }

  if (resource === "shifts" || resource === "attendance") {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to || !isDate(from) || !isDate(to)) return fail("from and to are required dates in the form YYYY-MM-DD.");
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1) return fail("to must not be before from.");
    if (days > MAX_RANGE_DAYS) return fail(`The range from..to may cover at most ${MAX_RANGE_DAYS} days.`);
    query.from = from;
    query.to = to;
  }
  return { ok: true, query };
}
