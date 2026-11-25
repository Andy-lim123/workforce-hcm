import { createAdminClient } from "@/lib/supabase/admin";
import { checkApiKey, parseQuery, type HrmsQuery, type Resource } from "@/lib/hrms";

// Shared by the four HRMS routes. Order matters: the API key is checked before parameters are read and before any database
// client exists. The data is read with the secret key, which bypasses row-level security, so every loader in data.ts names
// its columns and nothing else is ever returned. Errors never carry database text, and nothing is logged.

export type Loaded = { data: unknown[]; total: number };
export type Loader = (db: NonNullable<ReturnType<typeof createAdminClient>>, query: HrmsQuery) => Promise<Loaded | null>;

const HEADERS = { "Cache-Control": "no-store" };

const refuse = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: { ...HEADERS, ...extra } });

export async function handleHrms(request: Request, resource: Resource, load: Loader): Promise<Response> {
  // Reading the request headers first also keeps this handler out of build-time prerendering.
  const verdict = checkApiKey(request.headers.get("authorization"), process.env.HRMS_API_KEY);
  if (verdict === "disabled") return refuse(503, "unavailable", "The HRMS API is not switched on.");
  if (verdict !== "ok") return refuse(401, "unauthorized", "A valid API key is required in the Authorization header.", { "WWW-Authenticate": "Bearer" });

  const parsed = parseQuery(resource, new URL(request.url).searchParams);
  if (!parsed.ok) return refuse(400, "invalid_request", parsed.message);

  const db = createAdminClient();
  if (!db) return refuse(503, "unavailable", "The HRMS API is not switched on.");

  try {
    const result = await load(db, parsed.query);
    if (!result) return refuse(500, "server_error", "The data could not be read. Try again.");
    const { limit, offset } = parsed.query;
    const page = resource === "departments" ? { limit: result.total, offset: 0, total: result.total } : { limit, offset, total: result.total };
    return Response.json({ data: result.data, page, generated_at: new Date().toISOString() }, { headers: HEADERS });
  } catch {
    return refuse(500, "server_error", "The data could not be read. Try again.");
  }
}
