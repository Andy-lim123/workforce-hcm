import { Suspense, type ReactNode } from "react";
import { getCurrentUser, requireRole, type Role } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Brand } from "./brand";
import { NavLinks, NavList, type NavItem } from "./nav-links";

// Shared shell for the admin and employee areas. The chrome is static; the user menu reads
// the session behind its own Suspense boundary. Pages gate themselves with <RequireRole>.
export function AppShell({
  areaLabel,
  nav,
  children,
}: {
  areaLabel: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-zinc-200 bg-white p-4 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between md:block">
          <Brand />
          <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase md:mt-6 md:mb-1 md:px-3">
            {areaLabel}
          </p>
        </div>
        <Suspense fallback={<NavList items={nav} pathname={null} />}>
          <NavLinks items={nav} />
        </Suspense>
        <div className="mt-auto hidden md:block">
          <Suspense fallback={<div className="h-16" />}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>

      {/* pb-28 keeps the last content and the sign-out button above the phone's fixed bottom bar. */}
      <main className="flex-1 px-4 pt-6 pb-28 md:px-10 md:py-8">
        {children}
        <div className="mt-10 md:hidden">
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

// Gate page content on the server. It must live in the page, not the layout: Next renders and
// sends a page segment independently of its layout, so a layout-level gate cannot hide it.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <RoleGate role={role}>{children}</RoleGate>
    </Suspense>
  );
}

async function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  await requireRole(role);
  return children;
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="border-t border-zinc-200 pt-4">
      <p className="truncate text-sm font-medium text-zinc-900">{user.fullName || user.email}</p>
      <p className="truncate text-xs text-zinc-500">{user.email}</p>
      <form action={signOut} className="mt-3">
        <button
          type="submit"
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
