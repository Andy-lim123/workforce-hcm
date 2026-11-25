# Friday demo checklist (27 November 2026)

About 10–12 minutes. Verified on 25 November on the production build.

## Before the demo (30 minutes ahead)

1. Close any other copy of the app running on port 3000.
2. In PowerShell, one command at a time:

```powershell
cd "C:\Users\JOAB\OneDrive\Documents\03-HCM\0-3_hcm"
```

```powershell
npm run build
```

```powershell
npm start
```

   Leave that window open. If the build stops with `EPERM` (OneDrive holding files), run this and build again:

```powershell
Remove-Item -Recurse -Force .next\server, .next\static -ErrorAction SilentlyContinue
```

3. Open a **second** PowerShell window, go to the same folder, and check the HRMS link:

```powershell
node scripts/hrms-sync-demo.mjs
```

   Expect: 34 employees, 5 departments, 124 published shifts, 132 attendance records, "Nothing was written."
4. Browser, two separate sign-ins: **normal window = administrator**, **InPrivate/Incognito window = EMP-0042**. Both at
   `http://localhost:3000`. Maximise the windows.
5. Phone: charged, Telegram open on the chat with `@UncleBadangBot`. Check the internet connection.
6. Do **not** press any Assign, Publish, Cancel or Send button
   you do not intend to use. Assignments cannot be removed in the app.

## Demo script

| # | Time | Window | Do | Say |
|---|---|---|---|---|
| 1 | 1 min | Admin | Dashboard | Live figures: 33 active employees, 62 shifts this week, unfilled shifts, overtime |
| 2 | 1.5 min | Admin | Schedules, this week (23 Nov), then **Next** (30 Nov) | Weekly roster; 30 Nov week is still being planned (draft) |
| 3 | 1.5 min | Admin | Open a draft shift from the week | Eligibility, warnings, overrides with a recorded reason (show, do not assign) |
| 4 | 2 min | Admin | **Auto-schedule preview** on the 30 Nov week; **Recalculate** | Suggests people, never assigns. 23 open, 10 proposed, **13 still uncovered** because of availability, weekly hours and rest; the method does not guarantee the best coverage |
| 5 | 1.5 min | Employee | Dashboard, My schedule, next week | Own published shifts only; drafts are hidden |
| 6 | 30 s | Employee | Type `http://localhost:3000/admin` | Sent back to the employee area |
| 7 | 1.5 min | Phone | Telegram messages (see below) | Alerts on publish and changes, reminders on demand |
| 8 | 1 min | Admin | Reports | Attendance and overtime by department; overtime is time beyond the scheduled length, no break data |
| 9 | 1 min | PowerShell | `node scripts/hrms-sync-demo.mjs` | A **simulated** HRMS on this computer pulling a read-only API with a key |

## Telegram step: decide beforehand

On 27 November the "tomorrow" reminder covers 28 November, when your account has **no** shift: it will not reach your phone.

- **Safe (changes nothing):** show the messages already received on 25 November.
- **Live alert (changes one shift):** in the admin window open **Thu 3 Dec, Evening Support** and press **Publish**. Your phone
  receives the alert (the two other people on it are reported as not linked) and the shift appears on the employee schedule.
  It is already full, so the preview figures do not change. Afterwards **Unpublish** returns it to draft and sends a
  "withdrawn" message. Do this only if you have decided to; publish nothing else.

If the result says "delivery unknown", the connection to Telegram was slow: do not send again, show the earlier messages.

## If something fails

| Problem | Do |
|---|---|
| Page stuck or error | Refresh once; then restart `npm start` |
| Signed out | Sign in again in that window |
| HRMS script says 503 or 401 | `HRMS_API_KEY` missing or changed in `.env.local`; restart `npm start` |
| No internet | The app's data is in the cloud: show the screenshots instead |

## Say honestly if asked

Runs on this computer only; HRMS is simulated; reminders are manual (no timed reminders); the scheduler only previews;
simultaneous edits are not fully protected by the database; assignments cannot be removed; only linked employees get Telegram
messages (one today); business units are departments only.
