import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Privileged client for Auth admin calls (create login, disable access). Server-only: import it
// from Server Actions or Server Components, never from a "use client" file. SUPABASE_SECRET_KEY
// has no NEXT_PUBLIC_ prefix, so Next never inlines it into browser bundles.
// Returns null when the key is not configured, so account features can say so instead of crashing.
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
