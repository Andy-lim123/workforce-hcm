import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "./database.types";

// Server client for Server Components, Server Actions and Route Handlers.
// Create one per request; never share it across requests.
export async function createClient() {
  const cookieStore = await cookies();
  // supabase-js reads the clock (Date.now) while loading the session. Partial prefetching may
  // prerender with cookies available, where clock reads are rejected; stop prerendering here.
  await connection();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
