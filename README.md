# Astute Work Tracker

Ventures → projects → modules → features. Admins plan and approve; the team gets a daily target list, logs work, and submits finished features with a note and documents. Progress rolls up automatically by size, and lag flags are shown to admins only.

**Live at https://tracker.ezyourlife.com**

## How it is built

| Part | Where it runs | Cost |
| --- | --- | --- |
| Web app (React) | GitHub Pages, built from this repo on every push to `main` | Free |
| Data, sign-in, documents, daily jobs | Supabase (Postgres, Auth, Storage, pg_cron) | Free tier |

There is no server to run. All the business rules (plan dates, progress, health, flags, daily targets, permissions) live in the database as functions, and the browser calls exactly one of them: `public.api(method, path, body)`. Tables sit in a private `app` schema that the browser cannot reach.

## Try it with the demo team

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@demo.local` | `demo1234` |
| Team | `riya@demo.local`, `arjun@demo.local`, `neha@demo.local`, `karan@demo.local` | `demo1234` |

The demo data is dated around the day it was loaded, so flags and late work show up straight away.

## Setting up Supabase (once)

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the whole of [`supabase/setup.sql`](supabase/setup.sql) and click **Run**. It creates everything and loads the demo team. Running it again later is safe: it updates the functions and leaves your data alone.
3. **Authentication → URL Configuration**: set Site URL to `https://tracker.ezyourlife.com`.

## Going live with real people

Add yourself as an admin (run in the SQL editor, with your own password):

```sql
select app.add_admin('you@company.com', 'Your Name', 'YourPassword1');
```

When you are done with the demo, wipe everything (demo people included) and keep just your admin account:

```sql
select app.start_fresh('you@company.com', 'Your Name', 'YourPassword1');
```

Then, in the app:

1. **Ventures and calendar**: add each venture, its weekly days off, and its holidays. Deadlines skip these days.
2. **People**: add everyone with their email. Choose Admin or Workforce and give a temporary password. Nobody can sign in unless they are added here.
3. **Projects**: create a project, then add modules. Every module needs a size, a start date, a duration in working days and its list of features. Assign people to the module or to individual features.
4. Or load many at once from a spreadsheet on the **Import** page (template provided there).

Everyone can change their password from **My account**.

## Google sign-in (optional)

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application. Authorised redirect URI: `https://qywialfcfqdtpqrifimo.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Sign In / Providers → Google: paste the client ID and secret, and enable it.
3. Set `VITE_GOOGLE_SIGNIN=on` in `.env.production` and push.

Only emails already added on the People page can get in; any other Google account is turned away.

## How the numbers work

| Item | Rule |
| --- | --- |
| Size weights | Small 1, Medium 2, Large 4 by default; editable per venture |
| Module % | Weight of approved features ÷ weight of all accepted features |
| Project % | Each module's % weighted by the module's size |
| Counts toward % | Only features an admin has approved. Submitted work shows as "in review" |
| Employee-added features | Visible and workable at once; count only after an admin accepts them and confirms the size |
| Health | Work done or in review, compared with what the plan says should be finished by today. Green ≥ 90% of expected, amber ≥ 70%, red below that or past the deadline |
| Feature dates | Planned automatically inside the module window, in proportion to size, one lane per lead person; admins can set them by hand |

## Daily loop (pg_cron, India time)

| Time | What happens |
| --- | --- |
| 7:00 AM | Each person's target list is built: overdue, sent back, due today, in progress, blocked, up next |
| Hourly | Flags are recalculated |
| 6:30 PM | In-app reminder to anyone who has not submitted today's log |
| 11:00 AM next working day | Yesterday's log locks |
| 11:45 PM | Progress snapshots for trend history |

## Flags (admins only)

Overdue, blocked too long, behind schedule, stalled (no log), review waiting, missing daily logs, overloaded person, unassigned work, and scope growth from added features. Thresholds are on the Ventures and calendar page. Flags clear themselves when the cause is fixed; admins can acknowledge one with a note.

## Changing the code

- Web app: `web/src`. `npm install`, then `npm run dev` runs it at http://localhost:5173 against the live Supabase project.
- Database: edit `supabase/sql/*.sql`, run `npm run setup-sql` to rebuild `supabase/setup.sql`, then run that file in the Supabase SQL editor.
- Pushing to `main` redeploys the site in about two minutes (see the Actions tab).

Testing without touching the live data: load `supabase/local/stubs.sql` then `supabase/setup.sql` into a local Postgres, run `npm run build:local` and `npm run local`, and open http://localhost:4400. The local server stands in for Supabase's sign-in and storage.

## Not built yet

Email and WhatsApp notifications (in-app only for now), leave tracking, deadline-extension requests, and admins limited to specific ventures.
