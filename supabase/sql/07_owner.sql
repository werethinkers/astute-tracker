-- =====================================================================
-- Owner helpers. Run them from the Supabase SQL editor only; the browser cannot call them.
-- No password is stored in this file: you type it when you run the line, and it is saved only as a hash.
--
--   select app.add_admin('you@company.com', 'Your Name', 'TemporaryPass1');
--       Adds an admin (or makes an existing person an admin) with a temporary password.
--
--   select app.start_fresh('you@company.com', 'Your Name', 'TemporaryPass1');
--       Deletes every person, venture, project and log, then leaves just this one admin.
--       If that person already has a sign-in, you may leave out the password to keep it.
--
-- After either one, sign in and change the password under "My account".
-- =====================================================================

-- The demo team is gone for good: remove its loader from older installs.
drop function if exists app.seed_demo();
drop function if exists app.demo_back(int);
drop function if exists app.demo_ahead(numeric);
drop function if exists app.demo_feat(text);

create or replace function app.add_admin(p_email text, p_name text, p_password text) returns text
language plpgsql security definer set search_path = app, extensions, public as $$
declare u app.users; prob text := app.validate_password(p_password);
begin
  if prob is not null then raise exception 'Password: %', prob; end if;
  select * into u from app.users where lower(email) = lower(trim(p_email));
  if u.id is null then
    insert into app.users (name, email, role, title) values (trim(p_name), lower(trim(p_email)), 'admin', 'Administrator') returning * into u;
  else
    update app.users set role = 'admin', active = true, name = coalesce(nullif(trim(p_name), ''), name) where id = u.id;
  end if;
  perform app.set_auth_password(u.id, p_password);
  return 'Admin ready: ' || lower(trim(p_email)) || '. Sign in and change the password under My account.';
end $$;

create or replace function app.start_fresh(p_email text, p_name text, p_password text default null) returns text
language plpgsql security definer set search_path = app, extensions, public as $$
declare
  em text := lower(trim(p_email));
  keep_auth uuid;
  drop_auth uuid[];
begin
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Give the admin''s email address.'; end if;
  if p_password is not null and app.validate_password(p_password) is not null then
    raise exception 'Password: %', app.validate_password(p_password);
  end if;
  select auth_id into keep_auth from app.users where lower(email) = em;
  if keep_auth is null then
    select id into keep_auth from auth.users where lower(email) = em;
  end if;
  if p_password is null and keep_auth is null then
    raise exception '% has no sign-in yet. Add a temporary password: select app.start_fresh(''%'', ''%'', ''TemporaryPass1'');', em, em, p_name;
  end if;
  drop_auth := array(select auth_id from app.users where auth_id is not null and auth_id is distinct from keep_auth);

  truncate app.progress_snapshots, app.audit_log, app.notifications, app.comments, app.flags, app.log_entries, app.daily_logs,
           app.daily_targets, app.submission_files, app.submissions, app.assignments, app.work_items, app.projects,
           app.holidays, app.companies, app.users restart identity cascade;
  -- Uploaded documents: newer Supabase versions only allow removing them through Storage itself.
  begin
    delete from storage.objects where bucket_id = 'submissions';
  exception when others then
    raise notice 'Uploaded documents were left in the "submissions" bucket; empty it from Storage if you want them gone.';
  end;
  delete from auth.users where id = any(drop_auth);

  insert into app.companies (name, weekly_offs) values ('Astute Group', app.setting('default_weekly_offs', '0'));
  insert into app.users (name, email, role, title, auth_id) values (trim(p_name), em, 'admin', 'Administrator', keep_auth);
  if p_password is not null then
    perform app.set_auth_password((select id from app.users where email = em), p_password);
  end if;
  return 'The tracker is empty. Only ' || em || ' remains, as admin.'
    || case when p_password is null then ' Sign in with your current password.' else ' Sign in and change the password under My account.' end;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.storage_can_write(text), app.storage_can_read(text), app.storage_can_delete(text) to authenticated;
