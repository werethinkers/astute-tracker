-- =====================================================================
-- The one function the browser can call: public.api(method, path, body)
-- It works out who is signed in, then hands the request to the matching route.
-- =====================================================================

create or replace function app.parse_query(qs text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(split_part(kv, '=', 1), replace(substr(kv, length(split_part(kv, '=', 1)) + 2), '+', ' ')), '{}')
  from unnest(string_to_array(coalesce(qs, ''), '&')) kv where kv <> ''
$$;

-- The signed-in person, linking their Supabase Auth account on first sign-in when needed.
create or replace function app.current_person() returns app.users
language plpgsql as $$
declare me app.users; em text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if auth.uid() is null then perform app.fail(401, 'Sign in to continue.'); end if;
  select * into me from app.users where auth_id = auth.uid();
  if me.id is null and em <> '' then
    update app.users set auth_id = auth.uid() where lower(email) = em and auth_id is null returning * into me;
  end if;
  if me.id is null then
    perform app.fail(403, coalesce(nullif(em, ''), 'This account') || ' has no account here. Ask an admin to add you.');
  end if;
  if not me.active then perform app.fail(403, 'This account is deactivated. Contact an admin.'); end if;
  return me;
end $$;

create or replace function public.api(method text, path text, body jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = app, extensions, public as $$
declare
  me app.users; m text := upper(coalesce(method, 'GET')); p text; q jsonb; id bigint; seg text;
begin
  me := app.current_person();
  body := coalesce(body, '{}'::jsonb);
  p := split_part(coalesce(path, ''), '?', 1);
  q := app.parse_query(split_part(coalesce(path, ''), '?', 2));
  if p ~ '/\d+(/|$)' then id := substring(p from '/(\d+)(?:/|$)')::bigint; end if;

  begin
    -- people and the signed-in user
    if m = 'GET' and p = '/me' then return app.r_me(me);
    elsif m = 'POST' and p = '/me/tutorial' then return app.r_tutorial_done(me);
    elsif m = 'GET' and p = '/people' then return app.r_people(me);
    elsif m = 'GET' and p = '/users' then return app.r_users(me);
    elsif m = 'POST' and p = '/users' then return app.r_user_create(me, body);
    elsif m = 'PATCH' and p ~ '^/users/\d+$' then return app.r_user_update(me, id, body);

    -- ventures and calendars
    elsif m = 'GET' and p = '/companies' then return app.r_companies(me);
    elsif m = 'POST' and p = '/companies' then return app.r_company_create(me, body);
    elsif m = 'PATCH' and p ~ '^/companies/\d+$' then return app.r_company_update(me, id, body);
    elsif m = 'GET' and p ~ '^/companies/\d+/holidays$' then return app.r_holidays(me, id);
    elsif m = 'POST' and p ~ '^/companies/\d+/holidays$' then return app.r_holiday_add(me, id, body);
    elsif m = 'DELETE' and p ~ '^/holidays/\d+$' then return app.r_holiday_delete(me, id);

    -- projects, modules, features
    elsif m = 'GET' and p = '/projects' then return app.r_projects(me);
    elsif m = 'POST' and p = '/projects' then return app.r_project_create(me, body);
    elsif m = 'PATCH' and p ~ '^/projects/\d+$' then return app.r_project_update(me, id, body);
    elsif m = 'GET' and p ~ '^/projects/\d+$' then return app.r_project(me, id);
    elsif m = 'GET' and p ~ '^/projects/\d+/activity$' then return app.r_project_activity(me, id);
    elsif m = 'POST' and p ~ '^/projects/\d+/modules$' then return app.r_module_create(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/features$' then return app.r_feature_create(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/propose$' then return app.r_feature_propose(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/accept$' then return app.r_feature_accept(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/decline$' then return app.r_feature_decline(me, id, body);
    elsif m = 'PATCH' and p ~ '^/items/\d+$' then return app.r_item_update(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/status$' then return app.r_item_status(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/assignees$' then return app.r_item_assignees(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/progress$' then return app.r_item_progress(me, id, body);
    elsif m = 'DELETE' and p ~ '^/items/\d+$' then return app.r_item_delete(me, id);
    elsif m = 'POST' and p ~ '^/items/\d+/join$' then return app.r_item_join(me, id);
    elsif m = 'POST' and p ~ '^/items/\d+/leave$' then return app.r_item_leave(me, id);
    elsif m = 'GET' and p ~ '^/items/\d+$' then return app.r_item(me, id);
    elsif m = 'POST' and p ~ '^/items/\d+/comments$' then return app.r_comment(me, id, body);
    elsif m = 'POST' and p ~ '^/items/\d+/submit$' then return app.r_submit(me, id, body);
    elsif m = 'POST' and p ~ '^/submissions/\d+/decide$' then return app.r_decide(me, id, body);
    elsif m = 'GET' and p ~ '^/files/\d+$' then return app.r_file(me, id);
    elsif m = 'POST' and p = '/import' then return app.r_import(me, body);

    -- admin screens
    elsif p like '/admin/%' and me.role <> 'admin' then perform app.fail(403, 'Only admins can do this.');
    elsif m = 'GET' and p = '/admin/overview' then return app.r_overview(me);
    elsif m = 'GET' and p = '/admin/flags' then return app.r_flags(me, q->>'cleared' = '1');
    elsif m = 'POST' and p ~ '^/admin/flags/\d+/ack$' then return app.r_flag_ack(me, id, body);
    elsif m = 'GET' and p = '/admin/portfolio' then return app.r_portfolio(me);
    elsif m = 'GET' and p = '/admin/team' then
      return app.r_team(me, case when app.is_valid_date(q->>'date') then (q->>'date')::date end);
    elsif m = 'GET' and p ~ '^/admin/people/\d+$' then return app.r_person(me, id);
    elsif m = 'GET' and p = '/admin/workload' then return app.r_workload(me, q->>'days');
    elsif m = 'GET' and p = '/admin/reviews' then return app.r_reviews(me);
    elsif m = 'GET' and p = '/admin/day' then return app.r_admin_day(me, q);
    elsif m = 'POST' and p = '/admin/targets' then return app.r_adhoc_add(me, body);
    elsif m = 'DELETE' and p ~ '^/admin/targets/\d+$' then return app.r_adhoc_delete(me, id);
    elsif m = 'GET' and p = '/admin/settings' then return app.r_settings(me);
    elsif m = 'PATCH' and p = '/admin/settings' then return app.r_settings_update(me, body);
    elsif m = 'POST' and p = '/admin/recalculate' then return app.r_recalculate(me);

    -- my day
    elsif m = 'GET' and p = '/me/today' then return app.r_me_today(me, q);
    elsif m = 'PUT' and p ~ '^/me/log/[^/]+$' then return app.r_me_log(me, substring(p from '^/me/log/([^/]+)$'), body);
    elsif m = 'GET' and p = '/me/work' then return app.r_me_work(me);
    elsif m = 'GET' and p = '/me/logs' then return app.r_me_logs(me);
    elsif m = 'GET' and p = '/notifications' then return app.r_notifications(me);
    elsif m = 'POST' and p = '/notifications/read' then return app.r_notifications_read(me, body);
    end if;
    perform app.fail(404, 'Not found.');
  exception
    when sqlstate 'P0001' then raise;
    when unique_violation then perform app.fail(409, 'That already exists.');
    when others then
      raise log 'tracker api % % failed: % (%)', m, p, sqlerrm, sqlstate;
      perform app.fail(500, 'Something went wrong on the server. Try again. (' || sqlerrm || ')');
  end;
  return null;
end $$;

-- ---------- sign-up guard ----------
-- Only people an admin has added can get a sign-in. Admin-created passwords pass through
-- app.set_auth_password; Google sign-in works for added emails; open email sign-up is refused.
create or replace function app.guard_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare person app.users;
begin
  if coalesce(current_setting('app.creating_user', true), '') = 'on' then return new; end if;
  select * into person from app.users where lower(email) = lower(new.email);
  if person.id is null or not person.active then
    raise exception 'This email has not been added to the Astute work tracker. Ask an admin to add you.';
  end if;
  if coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then
    raise exception 'Accounts are created by admins in the tracker. Ask an admin to add you.';
  end if;
  if person.auth_id is not null then raise exception 'This person already has a sign-in.'; end if;
  update app.users set auth_id = new.id where id = person.id;
  return new;
end $$;

drop trigger if exists tracker_guard_new_auth_user on auth.users;
create trigger tracker_guard_new_auth_user before insert on auth.users
for each row execute function app.guard_new_auth_user();

-- ---------- file storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Files go in a folder named after the uploader's sign-in id.
create or replace function app.storage_can_write(obj text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select auth.uid() is not null and split_part(obj, '/', 1) = auth.uid()::text
     and exists (select 1 from app.users u where u.auth_id = auth.uid() and u.active)
$$;

-- Readable by the uploader, or by anyone who can see the feature the file was submitted for.
create or replace function app.storage_can_read(obj text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.users u
    where u.auth_id = auth.uid() and u.active and (
      split_part(obj, '/', 1) = auth.uid()::text
      or exists (select 1 from app.submission_files sf join app.submissions s on s.id = sf.submission_id
                 where sf.stored_name = obj and app.can_see(u.id, u.role = 'admin', s.work_item_id))))
$$;

-- Uploaders can remove their own files only until they are part of a submission.
create or replace function app.storage_can_delete(obj text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.storage_can_write(obj) and not exists (select 1 from app.submission_files where stored_name = obj)
$$;

drop policy if exists tracker_files_insert on storage.objects;
create policy tracker_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and app.storage_can_write(name));
drop policy if exists tracker_files_select on storage.objects;
create policy tracker_files_select on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and app.storage_can_read(name));
drop policy if exists tracker_files_delete on storage.objects;
create policy tracker_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and app.storage_can_delete(name));

-- ---------- permissions ----------
-- Nothing in "app" is callable from the browser except the three storage checks the policies use.
grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.storage_can_write(text), app.storage_can_read(text), app.storage_can_delete(text) to authenticated;
revoke execute on function public.api(text, text, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb) to authenticated;

-- ---------- scheduled jobs (IST times, written in UTC) ----------
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobname) from cron.job where jobname like 'tracker-%';
    perform cron.schedule('tracker-morning',   '30 1 * * *',  'select app.job_morning()');    -- 7:00 AM IST: flags + target lists
    perform cron.schedule('tracker-reminders', '0 13 * * *',  'select app.job_reminders()');  -- 6:30 PM IST: log reminders
    perform cron.schedule('tracker-flags',     '5 * * * *',   'select app.job_hourly()');     -- hourly: flags
    perform cron.schedule('tracker-nightly',   '15 18 * * *', 'select app.job_nightly()');    -- 11:45 PM IST: snapshots
  else
    raise notice 'pg_cron is not available here; scheduled jobs were not created.';
  end if;
end
$outer$;
