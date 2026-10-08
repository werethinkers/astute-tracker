# Astute Work Tracker

Ventures → projects → modules → features. Admins plan and approve; the team gets a daily target list, logs work, and submits finished features with a note and documents. Progress rolls up automatically by size, and lag flags are shown to admins only.

**Live at https://tracker.ezyourlife.com**

## How it is built

| Part | Where it runs | Cost |
| --- | --- | --- |
| Web app (React) | GitHub Pages, built from this repo on every push to `main` | Free |
| Data, sign-in, documents, daily jobs | Supabase (Postgres, Auth, Storage, pg_cron) | Free tier |

There is no server to run. All the business rules (plan dates, progress, health, flags, daily targets, permissions) live in the database as functions, and the browser calls exactly one of them: `public.api(method, path, body)`. Tables sit in a private `app` schema that the browser cannot reach.

## Setting up Supabase

1. In the Supabase dashboard open **SQL Editor → New query**, paste the whole of [`supabase/setup.sql`](supabase/setup.sql) and click **Run**. It creates or updates everything and never touches existing data, so it is safe to run again after changes.
2. In a new query, create the first admin with a temporary password you choose (the password is stored only as a hash):

   ```sql
   select app.start_fresh('you@company.com', 'Your Name', 'TemporaryPass1');
   ```

   `start_fresh` also empties the tracker, leaving only that admin. To add another admin later without clearing anything, use `select app.add_admin('them@company.com', 'Their Name', 'TemporaryPass1');`, or add them on the People page.
3. **Authentication → URL Configuration**: set Site URL to `https://tracker.ezyourlife.com`.

Sign in, then change the password under **My account**.

## First sign-in walkthrough

Everyone sees a short illustrated walkthrough the first time they sign in: admins get the admin tour, team members the team tour. They step through it before the app opens. Anyone can watch it again from **How it works** in the menu.

## Adding people and work

1. **Ventures and calendar**: add each venture, its weekly days off, and its holidays. Deadlines skip these days.
2. **People**: add everyone with their email. Choose Admin or Workforce and give a temporary password. Nobody can sign in unless they are added here.
3. **Projects**: create a project, then add modules. Every module needs a size, a start date, a duration in working days and its list of features. Assign people to the module or to individual features.
4. Or load many at once from a spreadsheet on the **Import** page (template provided there).

## What the team can do on their own

Everyone sees every venture and project, with all their modules and features, so they can check what is already planned before adding anything.

- **Add a module** to any active project: its features and sizes, a start date and a deadline (or a number of working days), and who else works on it. The person adding it is always on it. No approval is needed; admins get a notification. Afterwards they can add features to it and change who works on it.
- **Join** any open module or feature to show their part in it, with no approval; admins get a notification. They can leave work they joined themselves, but not work someone else put them on.
- **Suggest a feature** for someone else's module. It is theirs to work on at once, and counts toward progress once an admin accepts it.
- **Dates:** once a module's deadline is set, only admins can change its dates or its features' dates.
- **No duplicates:** a module name already used in the project, or a feature name already used in the module, is refused. The form lists what already exists.

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
| Modules added by the team | Count like any other module from the start; their finished features still go through review |
| Features the team suggests | Visible and workable at once; count only after an admin accepts them and confirms the size |
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

Testing without touching the live data: load `supabase/local/stubs.sql` then `supabase/setup.sql` into a local Postgres, create a local admin with `app.start_fresh(...)`, run `npm run build:local` and `npm run local`, and open http://localhost:4400. The local server stands in for Supabase's sign-in and storage.

## Not built yet

Email and WhatsApp notifications (in-app only for now), leave tracking, deadline-extension requests, and admins limited to specific ventures.
