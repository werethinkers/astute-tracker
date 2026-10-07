-- =====================================================================
-- Owner helpers (run from the Supabase SQL editor only; not callable from the browser)
--   select app.add_admin('you@company.com', 'Your Name', 'YourPassword1');  -- add a real admin
--   select app.start_fresh('you@company.com', 'Your Name', 'YourPassword1'); -- wipe everything incl. demo, keep one admin
--   select app.seed_demo();                                                  -- demo data (runs only on an empty tracker)
-- =====================================================================

create or replace function app.add_admin(p_email text, p_name text, p_password text) returns text
language plpgsql security definer set search_path = app, extensions, public as $$
declare u app.users; prob text := app.validate_password(p_password);
begin
  if prob is not null then raise exception 'Password: %', prob; end if;
  select * into u from app.users where lower(email) = lower(p_email);
  if u.id is null then
    insert into app.users (name, email, role, title) values (p_name, lower(p_email), 'admin', 'Administrator') returning * into u;
  else
    update app.users set role = 'admin', active = true, name = coalesce(nullif(p_name, ''), name) where id = u.id;
  end if;
  perform app.set_auth_password(u.id, p_password);
  return 'Admin ready: ' || lower(p_email);
end $$;

create or replace function app.start_fresh(p_email text, p_name text, p_password text) returns text
language plpgsql security definer set search_path = app, extensions, public as $$
declare auth_ids uuid[];
begin
  if app.validate_password(p_password) is not null then raise exception 'Password: %', app.validate_password(p_password); end if;
  auth_ids := array(select auth_id from app.users where auth_id is not null);
  truncate app.progress_snapshots, app.audit_log, app.notifications, app.comments, app.flags, app.log_entries, app.daily_logs,
           app.daily_targets, app.submission_files, app.submissions, app.assignments, app.work_items, app.projects,
           app.holidays, app.companies, app.users restart identity cascade;
  delete from storage.objects where bucket_id = 'submissions';
  delete from auth.users where id = any(auth_ids);
  insert into app.companies (name, weekly_offs) values ('Astute Group', app.setting('default_weekly_offs', '0'));
  perform app.add_admin(p_email, p_name, p_password);
  return 'Tracker emptied. Sign in as ' || lower(p_email);
end $$;

-- Sample ventures, projects, people, logs, flags and reviews, dated around today.
create or replace function app.seed_demo() returns text
language plpgsql security definer set search_path = app, extensions, public as $$
declare
  adm app.users; riya app.users; arjun app.users; neha app.users; karan app.users;
  astute bigint; northwind bigint; p1 bigint; p2 bigint; m2 bigint; res jsonb; s record; i int; d date; lid bigint;
  ppl jsonb := '[["Riya Sharma","riya@demo.local","Mobile developer"],["Arjun Mehta","arjun@demo.local","Backend developer"],
                 ["Neha Verma","neha@demo.local","Product designer"],["Karan Patel","karan@demo.local","Frontend developer"]]';
  x jsonb; u app.users;
begin
  if exists (select 1 from app.users) then return 'Skipped: the tracker already has people. Use app.start_fresh first.'; end if;

  -- People (password demo1234 for everyone).
  insert into app.users (name, email, role, title) values ('Demo Admin', 'admin@demo.local', 'admin', 'Administrator') returning * into adm;
  perform app.set_auth_password(adm.id, 'demo1234');
  for x in select * from jsonb_array_elements(ppl) loop
    insert into app.users (name, email, role, title) values (x->>0, x->>1, 'workforce', x->>2) returning * into u;
    perform app.set_auth_password(u.id, 'demo1234');
    perform app.notify(array[u.id], 'welcome', 'Welcome to the Astute work tracker, ' || split_part(u.name, ' ', 1),
      'Your daily targets appear on the Today screen.', '/');
  end loop;
  select * into adm from app.users where email = 'admin@demo.local';
  select * into riya from app.users where email = 'riya@demo.local';
  select * into arjun from app.users where email = 'arjun@demo.local';
  select * into neha from app.users where email = 'neha@demo.local';
  select * into karan from app.users where email = 'karan@demo.local';

  -- Ventures and projects.
  insert into app.companies (name, weekly_offs) values ('Astute Group', app.setting('default_weekly_offs', '0'))
    on conflict do nothing;
  select id into astute from app.companies where lower(name) = 'astute group';
  northwind := ((app.r_company_create(adm, '{"name":"Northwind Retail","weekly_offs":"0,6"}'))->'company'->>'id')::bigint;
  p1 := ((app.r_project_create(adm, jsonb_build_object('company_id', astute, 'name', 'Field Ops App',
          'description', 'Mobile app for field technicians.')))->'project'->>'id')::bigint;
  p2 := ((app.r_project_create(adm, jsonb_build_object('company_id', northwind, 'name', 'Website relaunch',
          'description', 'New marketing site.', 'target_end_date', app.demo_ahead(14))))->'project'->>'id')::bigint;

  -- Modules with features and teams.
  perform app.r_module_create(adm, p1, jsonb_build_object('name', 'Login and onboarding', 'size', 'large',
    'start_date', app.demo_back(11), 'duration_days', 12,
    'features', '[{"name":"Phone OTP login","size":"large","requires_proof":true},{"name":"Profile setup","size":"medium"},
                  {"name":"Welcome tour","size":"small"},{"name":"Role permissions","size":"small"}]'::jsonb,
    'assignee_ids', jsonb_build_array(riya.id, arjun.id), 'lead_id', riya.id));
  res := app.r_module_create(adm, p1, jsonb_build_object('name', 'Job scheduling', 'size', 'medium',
    'start_date', app.demo_back(5), 'duration_days', 12,
    'features', '[{"name":"Calendar view","size":"medium"},{"name":"Assign jobs","size":"medium"},{"name":"Reminders","size":"small"}]'::jsonb,
    'assignee_ids', jsonb_build_array(neha.id), 'lead_id', neha.id));
  m2 := (res->'module'->>'id')::bigint;
  perform app.r_module_create(adm, p1, jsonb_build_object('name', 'Reports', 'size', 'small',
    'start_date', app.demo_ahead(5), 'duration_days', 6,
    'features', '[{"name":"Weekly summary PDF","size":"medium"},{"name":"Export to Excel","size":"small"}]'::jsonb,
    'assignee_ids', jsonb_build_array(karan.id), 'lead_id', karan.id));
  perform app.r_module_create(adm, p2, jsonb_build_object('name', 'Design system', 'size', 'medium',
    'start_date', app.demo_back(8), 'duration_days', 6,
    'features', '[{"name":"Colour and type tokens","size":"small"},{"name":"Components","size":"large","requires_proof":true}]'::jsonb,
    'assignee_ids', jsonb_build_array(karan.id), 'lead_id', karan.id));
  perform app.r_module_create(adm, p2, jsonb_build_object('name', 'Content migration', 'size', 'large',
    'start_date', app.demo_back(2), 'duration_days', 15,
    'features', '[{"name":"Blog posts","size":"medium"},{"name":"Case studies","size":"medium"},{"name":"Redirect map","size":"small"}]'::jsonb,
    'assignee_ids', jsonb_build_array(arjun.id), 'lead_id', arjun.id));

  -- Split the onboarding module: Arjun owns profile setup and permissions.
  perform app.r_item_assignees(adm, app.demo_feat('Profile setup'), jsonb_build_object('user_ids', jsonb_build_array(arjun.id)));
  perform app.r_item_assignees(adm, app.demo_feat('Role permissions'), jsonb_build_object('user_ids', jsonb_build_array(arjun.id)));
  perform app.r_item_assignees(adm, app.demo_feat('Phone OTP login'), jsonb_build_object('user_ids', jsonb_build_array(riya.id)));
  perform app.r_item_assignees(adm, app.demo_feat('Welcome tour'), jsonb_build_object('user_ids', jsonb_build_array(riya.id)));

  -- Today's work.
  perform app.r_me_today(riya, '{}');
  perform app.r_me_log(riya, app.app_today()::text, jsonb_build_object('submit', false, 'entries', jsonb_build_array(
    jsonb_build_object('work_item_id', app.demo_feat('Phone OTP login'), 'work_done', 'Finished OTP retry flow and rate limiting', 'hours', 5))));
  perform app.r_submit(riya, app.demo_feat('Phone OTP login'), jsonb_build_object(
    'note', 'OTP login works on Android and iOS, with resend after 30 seconds and a lock after 5 wrong codes.',
    'links', '["https://example.com/build/otp-demo"]'::jsonb));
  perform app.r_me_log(arjun, app.app_today()::text, jsonb_build_object('submit', true, 'entries', jsonb_build_array(
    jsonb_build_object('work_item_id', app.demo_feat('Profile setup'), 'work_done', 'Profile form and photo upload', 'hours', 4),
    jsonb_build_object('work_item_id', app.demo_feat('Blog posts'), 'work_done', 'Moved 40 posts', 'hours', 3))));
  perform app.r_submit(arjun, app.demo_feat('Profile setup'), jsonb_build_object(
    'note', 'Profile setup done: name, photo, skills and home location, saved to the server on each step.'));
  perform app.r_feature_propose(neha, m2, jsonb_build_object('name', 'Recurring jobs', 'size', 'medium',
    'reason', 'Clients book monthly maintenance; without repeats every visit is entered by hand.'));
  perform app.r_item_status(karan, app.demo_feat('Components'), '{"status":"blocked","reason":"Waiting for brand fonts from the client"}');

  -- Admin reviews: approve Riya, send back Arjun.
  for s in select sb.id, f.name from app.submissions sb join app.work_items f on f.id = sb.work_item_id where sb.decision is null order by sb.id loop
    if s.name = 'Phone OTP login' then perform app.r_decide(adm, s.id, '{"decision":"approve"}');
    else perform app.r_decide(adm, s.id, '{"decision":"reject","reason":"Photo upload fails on slow networks. Add a retry and a progress bar."}');
    end if;
  end loop;
  perform app.r_adhoc_add(adm, jsonb_build_object('user_id', neha.id, 'title', 'Client call with Northwind at 4 PM'));

  -- History: past logs and an older block.
  for i in 1..8 loop
    d := app.demo_back(i);
    insert into app.daily_logs (user_id, date, submitted_at) values (riya.id, d, now()) returning id into lid;
    insert into app.log_entries (log_id, work_item_id, work_done, hours) values (lid, app.demo_feat('Phone OTP login'), 'OTP screens and API wiring', 7);
    if i % 3 <> 0 then
      insert into app.daily_logs (user_id, date, submitted_at) values (arjun.id, d, now()) returning id into lid;
      insert into app.log_entries (log_id, work_item_id, work_done, hours) values (lid, app.demo_feat('Profile setup'), 'Profile API', 6);
    end if;
    if i > 2 then
      insert into app.daily_logs (user_id, date, submitted_at) values (karan.id, d, now()) returning id into lid;
      insert into app.log_entries (log_id, work_item_id, work_done, hours) values (lid, app.demo_feat('Colour and type tokens'), 'Tokens and docs', 6);
    end if;
  end loop;
  update app.work_items set status = 'in_progress', started_at = (app.demo_back(6)::text || ' 09:00:00+00')::timestamptz where id = app.demo_feat('Colour and type tokens');
  update app.work_items set blocked_at = (app.demo_back(4)::text || ' 09:00:00+00')::timestamptz where id = app.demo_feat('Components');
  update app.work_items set status = 'in_progress', started_at = (app.demo_back(5)::text || ' 09:00:00+00')::timestamptz where id = app.demo_feat('Calendar view');
  update app.users set created_at = (app.demo_back(15)::text || ' 09:00:00+00')::timestamptz;
  perform app.recalc_all();
  perform app.refresh_flags();
  perform app.take_snapshots();
  return 'Demo ready. Admin: admin@demo.local / demo1234. Team: riya@, arjun@, neha@, karan@demo.local / demo1234';
end $$;

-- n working days before today (group calendar)
create or replace function app.demo_back(n int) returns date
language plpgsql stable as $$
declare d date := app.app_today(); i int;
begin
  for i in 1..n loop d := app.prev_wd(d, null); end loop;
  return d;
end $$;

create or replace function app.demo_ahead(n numeric) returns date
language sql stable as $$ select app.app_today() + round(n * 1.2)::int $$;

create or replace function app.demo_feat(nm text) returns bigint
language sql stable as $$ select id from app.work_items where name = nm order by id limit 1 $$;

revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.storage_can_write(text), app.storage_can_read(text), app.storage_can_delete(text) to authenticated;
