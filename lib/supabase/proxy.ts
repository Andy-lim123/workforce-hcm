import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

const PROTECTED = /^\/(admin|me)(\/|$)/;

// Refreshes the Supabase session cookie on every request and makes the optimistic
// signed-in / signed-out redirect. Role checks happen server-side in lib/auth.ts and in RLS.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Must run before anything else: it validates the JWT and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  };

  // Server Action POSTs must not get a redirect here: the action client cannot parse it and throws
  // "An unexpected response was received from the server". Actions check auth themselves
  // (requireRole), and their own redirect() responses are understood by the client.
  if (request.headers.has("next-action")) return response;

  if (!signedIn && (PROTECTED.test(pathname) || pathname === "/")) return redirectTo("/login");
  if (signedIn && pathname === "/login") return redirectTo("/");

  return response;
}
