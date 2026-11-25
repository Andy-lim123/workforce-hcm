"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** `short` is the label in the phone's bottom bar. `more` items sit behind a "More" button there; the sidebar shows all. */
export type NavItem = { href: string; label: string; short?: string; more?: boolean };

export function NavLinks({ items }: { items: NavItem[] }) {
  return <NavList items={items} pathname={usePathname()} />;
}

// Section roots (/admin, /me) match exactly; other items match their sub-paths too.
const isActive = (href: string, pathname: string | null) =>
  pathname !== null && (href.split("/").length === 2 ? pathname === href : pathname.startsWith(href));

const tone = (active: boolean) => (active ? "bg-teal-50 text-teal-800" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900");

// Rendered with pathname null as the Suspense fallback: dynamic routes such as
// /admin/employees/[id] only know their pathname at request time.
// One list, two layouts: a fixed bottom bar on phones, the sidebar from the md breakpoint up.
export function NavList({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
  const more = items.filter((item) => item.more);
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-zinc-200 bg-white px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:static md:flex-col md:border-0 md:p-0"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href, pathname) ? "page" : undefined}
          className={`min-h-12 flex-1 items-center justify-center rounded-lg px-1 text-center text-xs font-medium whitespace-nowrap md:min-h-0 md:flex-none md:justify-start md:rounded-md md:px-3 md:py-2 md:text-sm ${
            item.more ? "hidden md:flex" : "flex"
          } ${tone(isActive(item.href, pathname))}`}
        >
          {item.short ? (
            <>
              <span className="md:hidden">{item.short}</span>
              <span className="hidden md:inline">{item.label}</span>
            </>
          ) : (
            item.label
          )}
        </Link>
      ))}
      {more.length > 0 && (
        // keyed by the path, so the menu closes after navigating
        <details key={pathname} className="relative flex-1 md:hidden">
          <summary
            className={`flex min-h-12 cursor-pointer list-none items-center justify-center rounded-lg text-xs font-medium [&::-webkit-details-marker]:hidden ${tone(more.some((m) => isActive(m.href, pathname)))}`}
          >
            More
          </summary>
          <div className="absolute right-0 bottom-full mb-2 w-48 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
            {more.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href, pathname) ? "page" : undefined}
                className={`flex min-h-12 items-center rounded-lg px-3 text-sm font-medium ${tone(isActive(item.href, pathname))}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}
