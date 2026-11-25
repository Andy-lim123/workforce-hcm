# Workforce Management System

A portfolio project: a workforce management web app covering employees, departments, shift scheduling, availability, attendance and reporting. It is not tied to any real organisation. Every person and company in the demo data is fictional.

Stack: Next.js 16 (App Router, Cache Components), TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, RLS).

## Setup

1. Install dependencies: `npm install`
2. Create `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

   Only the publishable key is used by the app. Never put the service-role key in a `NEXT_PUBLIC_` variable.
3. Apply the SQL files in `supabase/migrations/` in order.
4. Load the demo data: run `supabase/seed.sql` in the Supabase SQL Editor. It does nothing if data already exists.
5. Create the demo logins (see [Demo accounts](#demo-accounts)).
6. Run `npm run dev` and open http://localhost:3000.

## Demo data

`supabase/seed.sql` builds a fictional company, with dates relative to the day you run it, in the `Asia/Manila` timezone:

- 5 departments: Customer Support, Warehouse, Retail, Logistics, Facilities.
- 14 positions, 16 skills, and 33 employees with skills and weekly availability. One employee is on leave.
- Shifts for last week and this week (published) and next week (draft).
- Assignments that respect department, position, availability, a 10-hour rest between shifts and weekly hour limits. Some shifts are deliberately left unfilled.
- Attendance for shifts that have already ended, including late arrivals, absences and overtime.

## Demo accounts

Add these to `.env.local` (the file is gitignored; never commit it):

```
SUPABASE_SECRET_KEY=<Project Settings → API Keys → secret key>
DEMO_ADMIN_EMAIL=<email for the demo admin>
DEMO_PASSWORD=<at least 12 characters>
```

Then run `npm run demo:accounts`. It creates:

| Login | Role | Linked employee |
|---|---|---|
| `DEMO_ADMIN_EMAIL` | admin | none |
| `maria.santos@example.com` | employee | Maria Santos, Support Team Lead |
| `noah.williams@example.com` | employee | Noah Williams, Sales Associate |

The secret key is only read by this local script and by server code. It must never appear in a `NEXT_PUBLIC_` variable.

## Authentication and roles

- Sign-in uses Supabase email and password, with the session stored in cookies (`@supabase/ssr`).
- There is no public registration page. Accounts are created by an administrator.
- Every new account gets the `employee` role. The role is never read from sign-up metadata.
- An account is linked to the `employees` record with the same email only once its email address is verified.
- Access is enforced in three layers:
  1. `proxy.ts` refreshes the session and sends signed-out visitors to `/login`.
  2. Each page calls `requireRole()` (`lib/auth.ts`) on the server, which redirects users with the wrong role.
  3. Row Level Security in Postgres limits what each user can read or write.

### Recommended Supabase Auth settings

In the Supabase dashboard, open **Authentication → Sign In / Providers**:

- Turn off **Allow new users to sign up**. The publishable key could otherwise be used to call the sign-up API directly. Such accounts would only get the `employee` role, but disabling sign-up removes the path entirely.
- Keep **Confirm email** turned on.

- Turn on **Prevent use of leaked passwords** (Authentication → Attack Protection), and set a minimum password length.

## Creating an administrator manually

`npm run demo:accounts` already creates the demo admin. To promote some other account instead:

The database blocks role changes made through the API unless the caller is already an admin. An admin must therefore first be promoted directly in the database, by the project owner.

1. In the Supabase dashboard, open **Authentication → Users → Add user → Create new user**. Enter the administrator's email and a strong password, and tick **Auto Confirm User**.
2. Open the **SQL Editor**. It runs as the database owner, not as an API user. Run:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'admin@your-domain.example';

   -- Confirm exactly one row changed:
   select email, role from public.profiles where role = 'admin';
   ```

3. Sign in at `/login`. You will be sent to `/admin`.

After that, admins can promote other users, because the role guard allows changes made by an existing admin. Never ship a service-role key to the browser to do this.

## Technical decisions

- **Separate `employees` and `profiles` tables.** HR records can exist before someone has a login, which matches how admins onboard staff.
- **Login linked to employee by verified email.** The link is made in a database trigger, and only after the email is verified. An unverified sign-up cannot claim someone else's employee record.
- **Authorization lives in the database.** RLS policies call `private.is_admin()` and similar helpers. They sit in a schema the Data API does not expose, so clients cannot call them directly.
- **Role changes are guarded by a trigger.** A user cannot promote themselves, even through the column they are allowed to update.
- **Page-level role checks.** Next.js renders a page separately from its layout, so a role check in a layout would not stop page content being sent. Each page checks the role itself.
- **`connection()` before Supabase calls.** With Cache Components and partial prefetching, Next may prerender pages using the visitor's cookies, but forbids reading the clock. supabase-js reads the clock, so server code waits for the real request first.
