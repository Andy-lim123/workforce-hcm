import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

// Browser client for Client Components. Reads the session from cookies set by the server.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
