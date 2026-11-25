// Creates the demo administrator and demo employee logins.
//
//   npm run demo:accounts
//
// Reads from .env.local (never commit it):
//   NEXT_PUBLIC_SUPABASE_URL   project URL
//   SUPABASE_SECRET_KEY        secret (service-role) key, server-only. Never prefix with NEXT_PUBLIC_
//   DEMO_ADMIN_EMAIL           login for the demo administrator
//   DEMO_PASSWORD              password for every demo account (min. 12 characters)
//
// Safe to re-run: existing accounts are left as they are. Employee logins use the emails of
// seeded employees, so the database trigger links each login to its employee record.
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, DEMO_ADMIN_EMAIL: adminEmail, DEMO_PASSWORD: password } =
  process.env;

const missing = Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, DEMO_ADMIN_EMAIL: adminEmail, DEMO_PASSWORD: password })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
if (password.length < 12) {
  console.error("DEMO_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const accounts = [
  { email: adminEmail, fullName: "Demo Administrator", role: "admin" },
  { email: "maria.santos@example.com", fullName: "Maria Santos", role: "employee" },
  { email: "noah.williams@example.com", fullName: "Noah Williams", role: "employee" },
];

for (const account of accounts) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true, // demo accounts skip the verification email
    user_metadata: { full_name: account.fullName },
  });

  if (error && error.code !== "email_exists") {
    console.error(`✗ ${account.email}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`${error ? "•" : "✓"} ${account.email} ${error ? "already exists" : "created"}`);

  if (account.role === "admin") {
    // The secret key acts as the database's service role, which the role guard allows.
    const query = supabase.from("profiles").update({ role: "admin" });
    const { error: roleError } = await (data?.user ? query.eq("id", data.user.id) : query.eq("email", account.email));
    if (roleError) {
      console.error(`✗ could not promote ${account.email}: ${roleError.message}`);
      process.exitCode = 1;
    } else {
      console.log(`  promoted to admin`);
    }
  }
}

const { data: linked } = await supabase
  .from("employees")
  .select("email, profile_id")
  .in("email", accounts.slice(1).map((a) => a.email));
for (const row of linked ?? []) console.log(`  ${row.email} linked to employee record: ${row.profile_id ? "yes" : "NO"}`);
