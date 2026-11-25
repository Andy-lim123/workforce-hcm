import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState, buttonClass, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, STATUS_TONES, TYPE_LABELS, formatDate, type EmployeeStatus } from "@/lib/labels";
import { isUuid, searchTerms } from "@/lib/validation";

export const metadata: Metadata = { title: "Employees" };

const PAGE_SIZE = 15;
const SORTS = {
  code: "employee_code",
  name: "last_name",
  type: "employment_type",
  status: "status",
  hired: "hire_date",
} as const;
type SortKey = keyof typeof SORTS;
type Params = Record<string, string | undefined>;

export default function Page({ searchParams }: PageProps<"/admin/employees">) {
  return (
    <RequireRole role="admin">
      <PageHeader title="Employees" description="Search, filter and manage employee records and logins." />
      <EmployeeDirectory searchParams={searchParams} />
    </RequireRole>
  );
}

async function EmployeeDirectory({ searchParams }: { searchParams: PageProps<"/admin/employees">["searchParams"] }) {
  const raw = await searchParams;
  const params: Params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const q = (params.q ?? "").trim();
  const department = isUuid(params.department) ? params.department : "";
  const position = isUuid(params.position) ? params.position : "";
  const status = params.status && params.status in STATUS_LABELS ? (params.status as EmployeeStatus) : "";
  const account = params.account === "yes" || params.account === "no" ? params.account : "";
  const sort: SortKey = params.sort && params.sort in SORTS ? (params.sort as SortKey) : "code";
  const dir = params.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("employees")
    .select(
      "id, employee_code, first_name, last_name, email, status, employment_type, hire_date, profile_id, department:departments(name), position:positions(title)",
      { count: "exact" },
    );
  for (const term of searchTerms(q)) {
    query = query.or(
      `first_name.ilike.*${term}*,last_name.ilike.*${term}*,employee_code.ilike.*${term}*,email.ilike.*${term}*`,
    );
  }
  if (department) query = query.eq("department_id", department);
  if (position) query = query.eq("position_id", position);
  if (status) query = query.eq("status", status);
  if (account === "yes") query = query.not("profile_id", "is", null);
  if (account === "no") query = query.is("profile_id", null);
  query = query.order(SORTS[sort], { ascending: dir === "asc" });
  if (sort === "name") query = query.order("first_name", { ascending: dir === "asc" });
  query = query.order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data: employees, count, error }, { count: allCount }, { data: departments }, { data: positions }] = await Promise.all([
    query,
    supabase.from("employees").select("id", { count: "exact", head: true }),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department:departments(name)").order("title"),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || department || position || status || account);

  const href = (overrides: Params) => {
    const next = new URLSearchParams();
    const merged = { q, department, position, status, account, sort, dir, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || (k === "page" && v === "1") || (k === "sort" && v === "code") || (k === "dir" && v === "asc")) continue;
      next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/admin/employees?${qs}` : "/admin/employees";
  };

  const sortHeader = (by: SortKey, children: string, extra = "") => {
    const active = sort === by;
    const nextDir = active && dir === "asc" ? "desc" : "asc";
    return (
      <th key={by} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-3 text-left font-medium ${extra}`}>
        <Link href={href({ sort: by, dir: nextDir, page: "1" })} className="inline-flex items-center gap-1 hover:text-zinc-900">
          {children}
          <span aria-hidden className={active ? "text-zinc-700" : "text-zinc-300"}>
            {active && dir === "desc" ? "↓" : "↑"}
          </span>
        </Link>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600" aria-live="polite">
        {error ? null : filtered ? (
          <><span className="font-semibold text-zinc-900">{total}</span> of {allCount ?? total} employees match</>
        ) : (
          <><span className="font-semibold text-zinc-900">{allCount ?? total}</span> employees</>
        )}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action="/admin/employees" className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-1 sm:flex-wrap">
          <div className="col-span-2 sm:w-64">
            <label htmlFor="q" className="sr-only">
              Search employees
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Search name, ID or email" className={inputClass} />
          </div>
          <FilterSelect name="department" label="Department" all="All departments" value={department}
            options={(departments ?? []).map((d) => [d.id, d.name])} />
          <FilterSelect name="position" label="Position" all="All positions" value={position}
            options={(positions ?? []).map((p) => [p.id, `${p.title} · ${p.department?.name ?? ""}`])} />
          <FilterSelect name="status" label="Status" all="All statuses" value={status} options={Object.entries(STATUS_LABELS)} />
          <FilterSelect name="account" label="Login" all="Any login status" value={account} options={[["yes", "Has login"], ["no", "No login"]]} />
          {sort !== "code" && <input type="hidden" name="sort" value={sort} />}
          {dir !== "asc" && <input type="hidden" name="dir" value={dir} />}
          <button type="submit" className={buttonClass.secondary}>
            Apply
          </button>
          {filtered && (
            <Link href="/admin/employees" className="px-2 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-900">
              Clear
            </Link>
          )}
        </form>
        <Link href="/admin/employees/new" className={`${buttonClass.primary} w-full sm:w-auto`}>
          Add employee
        </Link>
      </div>

      {error ? (
        <Alert tone="error">Could not load employees. Refresh the page to try again.</Alert>
      ) : !employees?.length ? (
        <EmptyState
          title={filtered ? "No employees match these filters" : "No employees yet"}
          description={filtered ? "Try a different search or clear the filters." : "Add your first employee to get started."}
          action={
            filtered ? (
              <Link href="/admin/employees" className={buttonClass.secondary}>Clear filters</Link>
            ) : (
              <Link href="/admin/employees/new" className={buttonClass.primary}>Add employee</Link>
            )
          }
        />
      ) : (
        <>
          {/* The table scrolls inside this box instead of widening the page. w-0 min-w-full: its width does not stretch
              the page. relative: the screen-reader-only (absolutely positioned) labels in the cells stay inside the box. */}
          <div className="relative w-0 min-w-full overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  {sortHeader("code", "ID", "hidden md:table-cell")}
                  {sortHeader("name", "Name")}
                  <th scope="col" className="hidden px-4 py-3 text-left font-medium md:table-cell">Department · Position</th>
                  {sortHeader("type", "Type", "hidden md:table-cell")}
                  {sortHeader("status", "Status")}
                  {sortHeader("hired", "Hired", "hidden md:table-cell")}
                  <th scope="col" className="hidden px-4 py-3 text-left font-medium md:table-cell">Login</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium md:table-cell">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {employees.map((e) => (
                  <tr key={e.id} className="hover:bg-zinc-50">
                    <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-600 md:table-cell">{e.employee_code}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/employees/${e.id}`} className="font-medium text-zinc-900 hover:text-teal-700 hover:underline">
                        {e.first_name} {e.last_name}
                      </Link>
                      <p className="text-xs break-all text-zinc-500">{e.email}</p>
                      <p className="mt-1 text-xs text-zinc-600 md:hidden">
                        <span className="font-mono">{e.employee_code}</span> · {e.department?.name ?? "No department"} · {e.position?.title ?? "No position"}
                      </p>
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-700 md:table-cell">
                      {e.department?.name ?? <span className="text-zinc-400">No department</span>}
                      <p className="text-xs text-zinc-500">{e.position?.title ?? "No position"}</p>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-700 md:table-cell">{TYPE_LABELS[e.employment_type]}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-700 md:table-cell">{formatDate(e.hire_date)}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 md:table-cell">
                      {e.profile_id ? <Badge tone="teal">Linked</Badge> : <Badge>No login</Badge>}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-right md:table-cell">
                      <div className="flex justify-end gap-3 text-sm font-medium">
                        <Link href={`/admin/employees/${e.id}`} className="text-teal-700 hover:underline">
                          View<span className="sr-only"> {e.first_name} {e.last_name}</span>
                        </Link>
                        <Link href={`/admin/employees/${e.id}/edit`} className="text-teal-700 hover:underline">
                          Edit<span className="sr-only"> {e.first_name} {e.last_name}</span>
                        </Link>
                        <Link href={`/admin/employees/${e.id}#account`} className="text-teal-700 hover:underline">
                          Manage<span className="sr-only"> login for {e.first_name} {e.last_name}</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-zinc-600">
            <p>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={href({ page: String(page - 1) })} className={buttonClass.secondary}>Previous</Link>
              ) : (
                <span aria-disabled className={`${buttonClass.secondary} pointer-events-none opacity-50`}>Previous</span>
              )}
              {page < pages ? (
                <Link href={href({ page: String(page + 1) })} className={buttonClass.secondary}>Next</Link>
              ) : (
                <span aria-disabled className={`${buttonClass.secondary} pointer-events-none opacity-50`}>Next</span>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function FilterSelect({ name, label, all, value, options }: { name: string; label: string; all: string; value: string; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      <select id={name} name={name} defaultValue={value} className={`${inputClass} sm:w-auto`}>
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
