// A SIMULATED HRMS: pulls the four resources of the read-only HRMS API and summarises them. It writes nothing anywhere.
//
//   node scripts/hrms-sync-demo.mjs [from] [to]        (dates YYYY-MM-DD, at most 31 days apart)
//
// The key comes from the HRMS_API_KEY environment variable, or from .env.local. It is never printed.
// HRMS_BASE_URL defaults to the local development server; this reaches nothing outside this computer.
import fs from "node:fs";

function fromEnvFile(name) {
  try {
    const line = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const key = process.env.HRMS_API_KEY || fromEnvFile("HRMS_API_KEY");
const base = (process.env.HRMS_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!key) {
  console.error("HRMS_API_KEY is not set. Add it to .env.local and restart the server (see HRMS_API.md).");
  process.exit(1);
}

const day = (offset) => new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10); // Manila date
const from = process.argv[2] ?? day(-15);
const to = process.argv[3] ?? day(15);

async function pull(path, params = {}) {
  const records = [];
  for (let offset = 0; ; ) {
    const query = new URLSearchParams(path === "departments" ? {} : { ...params, limit: "100", offset: String(offset) });
    const response = await fetch(`${base}/api/hrms/v1/${path}?${query}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(`${path}: HTTP ${response.status} ${body?.error?.message ?? ""}`);
    records.push(...body.data);
    offset += body.data.length;
    if (!body.data.length || offset >= body.page.total) return records;
  }
}

try {
  console.log(`Simulated HRMS sync from ${base}\nPeriod for shifts and attendance: ${from} to ${to}\n`);
  const employees = await pull("employees");
  const departments = await pull("departments");
  const shifts = await pull("shifts", { from, to });
  const attendance = await pull("attendance", { from, to });
  const hours = (field) => (attendance.reduce((sum, r) => sum + (r[field] ?? 0), 0) / 60).toFixed(1);

  console.log(`Employees:        ${employees.length} (${employees.filter((e) => e.status === "active").length} active)`);
  console.log(`Departments:      ${departments.length} (${departments.reduce((n, d) => n + d.positions.length, 0)} positions)`);
  console.log(`Published shifts: ${shifts.length} (${shifts.reduce((n, s) => n + s.assigned_employee_codes.length, 0)} assignments)`);
  console.log(`Attendance:       ${attendance.length} records, ${hours("worked_minutes")} h worked, ${hours("overtime_minutes")} h overtime`);

  const byDepartment = Map.groupBy(employees, (e) => e.department ?? "No department");
  console.log("\nHeadcount by department:");
  for (const [name, list] of [...byDepartment].sort()) console.log(`  ${name}: ${list.length}`);
  const sample = shifts[0];
  if (sample) console.log(`\nExample shift: ${sample.title}, ${sample.starts_at}, ${sample.department}, ${sample.assigned_employee_codes.join(" ") || "nobody assigned"}`);
  console.log("\nSync finished. Nothing was written.");
} catch (error) {
  console.error(`Sync failed: ${error.cause?.code ?? error.message}`);
  process.exit(1);
}
