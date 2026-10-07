-- =====================================================================
-- Flags (admins only), daily target lists, log locking, scheduled jobs
-- =====================================================================

-- Working days since a date (0 when the date is today or later, or missing).
create or replace function app.days_since(d date, on_ date, cid bigint) returns int
language sql stable as $$
  select case when d is not null and d < on_ then app.wd_between(d + 1, on_, cid) else 0 end
$$;

create or replace function app.plural_days(n int) returns text
language sql immutable as $$ select n || ' working day' || case when n = 1 then '' else 's' end $$;

-- Every flag whose condition holds today, as a JSON array.
create or replace function app.compute_flags(on_ date default null) returns jsonb
language plpgsql stable as $$
declare
  out_ jsonb := '[]';
  r record; who bigint[]; cid bigint; late int; d int; last_ date; since date; soon date;
  facts jsonb; sa numeric; sw numeric; scope_pct numeric; overdue bigint[] := '{}';
  d1 date; d2 date; soon_end date; lim numeric; uid bigint; n int; where_ text;
  due_by jsonb := '{}'; pu record;
begin
  on_ := coalesce(on_, app.app_today());

  -- Features in live projects and modules.
  for r in
    select f.*, m.name module_name, m.start_date module_start, p.name project_name, p.company_id cid
    from app.work_items f join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id
    where f.level = 'feature' and f.status in ('not_started','in_progress','blocked','submitted')
      and p.status = 'active' and m.status not in ('on_hold','cancelled')
    order by f.id
  loop
    cid := r.cid;
    who := app.effective_assignees(r.id);
    where_ := r.project_name || ' / ' || r.module_name;
    if r.status <> 'submitted' and r.planned_end is not null and r.planned_end < on_ then
      overdue := overdue || r.id;
      late := app.days_since(r.planned_end, on_, cid);
      out_ := out_ || jsonb_build_object('type','overdue','severity','red','entity_type','feature','entity_id',r.id,
        'project_id',r.project_id,'user_id',who[1],
        'title', r.name || ' is ' || app.plural_days(late) || ' late',
        'details', where_ || '. Was due ' || app.fd(r.planned_end) || '. Owner: ' || app.user_names(who) || '.');
    end if;
    if r.status = 'blocked' then
      d := app.days_since(app.local_date(r.blocked_at), on_, cid);
      if d > app.setting_num('flag_blocked_days', 2) then
        out_ := out_ || jsonb_build_object('type','blocked_long','severity','red','entity_type','feature','entity_id',r.id,
          'project_id',r.project_id,'user_id',who[1],
          'title', r.name || ' has been blocked for ' || d || ' working days',
          'details', where_ || '. Waiting on: ' || coalesce(r.status_reason, 'not stated') || '. Owner: ' || app.user_names(who) || '.');
      end if;
    end if;
    if r.status = 'in_progress' and not (r.id = any(overdue)) then
      select max(l.date) into last_ from app.log_entries e join app.daily_logs l on l.id = e.log_id where e.work_item_id = r.id;
      since := coalesce(last_, app.local_date(r.started_at));
      d := app.days_since(since, on_, cid);
      if since is not null and d >= app.setting_num('flag_stalled_days', 3) then
        out_ := out_ || jsonb_build_object('type','stalled','severity','amber','entity_type','feature','entity_id',r.id,
          'project_id',r.project_id,'user_id',who[1],
          'title', 'No work logged on ' || r.name || ' for ' || d || ' working days',
          'details', where_ || '. Last activity ' || app.fd(since) || '. Owner: ' || app.user_names(who) || '.');
      end if;
    end if;
    if r.status <> 'submitted' and r.module_start is not null and cardinality(who) = 0 then
      soon := app.next_wd(app.next_wd(on_, cid), cid);
      if r.module_start <= soon then
        out_ := out_ || jsonb_build_object('type','unassigned','severity','amber','entity_type','feature','entity_id',r.id,
          'project_id',r.project_id,
          'title', r.name || ' has nobody assigned',
          'details', where_ || '. Module starts ' || app.fd(r.module_start) || '.');
      end if;
    end if;
  end loop;

  -- Modules: overdue, behind schedule, or grown by added features.
  for r in
    select m.*, p.name project_name, p.company_id cid from app.work_items m join app.projects p on p.id = m.project_id
    where m.level = 'module' and p.status = 'active' and m.status not in ('done','on_hold','cancelled') and m.end_date is not null
    order by m.id
  loop
    facts := app.schedule_facts('module', r.id, on_);
    if r.end_date < on_ then
      late := app.days_since(r.end_date, on_, r.cid);
      out_ := out_ || jsonb_build_object('type','overdue','severity','red','entity_type','module','entity_id',r.id,'project_id',r.project_id,
        'title', 'Module ' || r.name || ' is past its deadline',
        'details', r.project_name || '. Due ' || app.fd(r.end_date) || ', ' || app.plural_days(late) || ' ago, ' || round(r.progress_pct::numeric) || '% done.');
    elsif facts->>'health' in ('amber','red') then
      out_ := out_ || jsonb_build_object('type','behind','severity',facts->>'health','entity_type','module','entity_id',r.id,'project_id',r.project_id,
        'title', 'Module ' || r.name || ' is behind schedule',
        'details', r.project_name || '. ' || round((r.progress_pct + r.pending_pct)::numeric) || '% done or in review; the plan expected '
          || round((facts->>'expected_pct')::numeric) || '% by now. Due ' || app.fd(r.end_date) || '.');
    end if;
    select coalesce(sum(case when origin = 'admin' then weight end),0), coalesce(sum(case when origin = 'workforce' then weight end),0)
      into sa, sw
    from app.work_items where parent_id = r.id and status not in ('proposed','cancelled');
    scope_pct := app.setting_num('flag_scope_growth_pct', 25);
    if sa > 0 and sw / sa * 100 > scope_pct then
      out_ := out_ || jsonb_build_object('type','scope_growth','severity','amber','entity_type','module','entity_id',r.id,'project_id',r.project_id,
        'title', 'Module ' || r.name || ' has grown ' || round(sw / sa * 100) || '% from added features',
        'details', r.project_name || '. Accepted employee-added features now weigh ' || sw || ' against ' || sa || ' planned.');
    end if;
  end loop;

  -- Projects behind schedule.
  for r in select * from app.projects where status = 'active' order by id loop
    facts := app.schedule_facts('project', r.id, on_);
    if facts->>'health' in ('amber','red') then
      out_ := out_ || jsonb_build_object('type','behind','severity',facts->>'health','entity_type','project','entity_id',r.id,'project_id',r.id,
        'title', r.name || ' is behind schedule',
        'details', round((r.progress_pct + r.pending_pct)::numeric) || '% done or in review; the plan expected '
          || round((facts->>'expected_pct')::numeric) || '% by now. Ends ' || app.fd((facts->>'end_date')::date) || '.');
    end if;
  end loop;

  -- Reviews waiting too long.
  for r in
    select s.*, f.name feature_name, f.project_id, u.name who_name, p.company_id cid
    from app.submissions s join app.work_items f on f.id = s.work_item_id join app.users u on u.id = s.submitted_by
    join app.projects p on p.id = f.project_id
    where s.decision is null and f.status = 'submitted' order by s.id
  loop
    d := app.days_since(app.local_date(r.submitted_at), on_, r.cid);
    if d > app.setting_num('flag_review_days', 2) then
      out_ := out_ || jsonb_build_object('type','review_waiting','severity','amber','entity_type','feature','entity_id',r.work_item_id,
        'project_id',r.project_id,'user_id',r.submitted_by,
        'title', r.feature_name || ' has waited ' || d || ' working days for review',
        'details', 'Submitted by ' || r.who_name || ' on ' || app.fd(app.local_date(r.submitted_at)) || '.');
    end if;
  end loop;

  -- People: missing logs.
  d1 := app.prev_wd(on_, null);
  d2 := app.prev_wd(d1, null);
  soon_end := app.next_wd(app.next_wd(on_, null), null);
  for pu in select * from app.users where active and role = 'workforce' order by id loop
    continue when not exists (
      select 1 from app.assignments a join app.work_items w on w.id = a.work_item_id join app.projects p on p.id = w.project_id
      where a.user_id = pu.id and p.status = 'active' and w.status not in ('done','cancelled'));
    if app.local_date(pu.created_at) <= d2 and not exists (
      select 1 from app.daily_logs dl where dl.user_id = pu.id and dl.date in (d1, d2) and dl.submitted_at is not null) then
      out_ := out_ || jsonb_build_object('type','missing_logs','severity','amber','entity_type','user','entity_id',pu.id,'user_id',pu.id,
        'title', pu.name || ' missed the last 2 daily logs',
        'details', 'No log submitted for ' || app.fd(d2) || ' or ' || app.fd(d1) || '.');
    end if;
  end loop;

  -- People: more features due in the next two working days than the limit.
  for r in
    select f.id, f.planned_end from app.work_items f join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id
    where f.level = 'feature' and f.status in ('not_started','in_progress','blocked')
      and p.status = 'active' and m.status not in ('on_hold','cancelled')
      and f.planned_end is not null and f.planned_end >= on_ and f.planned_end <= soon_end
    order by f.id
  loop
    foreach uid in array app.effective_assignees(r.id) loop
      due_by := jsonb_set(due_by, array[uid::text], to_jsonb(coalesce((due_by->>uid::text)::int, 0) + 1));
    end loop;
  end loop;
  lim := app.setting_num('flag_overload_count', 3);
  for r in select key::bigint uid, value::int n from jsonb_each_text(due_by) order by key::bigint loop
    continue when r.n <= lim;
    out_ := out_ || jsonb_build_object('type','overload','severity','amber','entity_type','user','entity_id',r.uid,'user_id',r.uid,
      'title', (select name from app.users where id = r.uid) || ' has ' || r.n || ' features due in the next 2 working days',
      'details', 'Due by ' || app.fd(soon_end) || '. Consider moving dates or sharing the work.');
  end loop;

  return out_;
end $$;

-- Raise new flags, update open ones, and clear those whose condition has ended.
create or replace function app.refresh_flags(on_ date default null) returns int
language plpgsql as $$
declare cur jsonb := app.compute_flags(on_); f jsonb; o app.flags; k text; keys text[] := '{}'; open_keys text[] := '{}';
begin
  for f in select * from jsonb_array_elements(cur) loop
    keys := keys || ((f->>'type') || ':' || (f->>'entity_type') || ':' || (f->>'entity_id'));
  end loop;
  for o in select * from app.flags where cleared_at is null order by id loop
    k := o.flag_key;
    if not (k = any(keys)) then
      update app.flags set cleared_at = now() where id = o.id;
    else
      open_keys := open_keys || k;
      select x into f from jsonb_array_elements(cur) x
      where (x->>'type') || ':' || (x->>'entity_type') || ':' || (x->>'entity_id') = k limit 1;
      update app.flags set severity = f->>'severity', title = f->>'title', details = f->>'details',
        project_id = (f->>'project_id')::bigint, user_id = (f->>'user_id')::bigint
      where id = o.id;
    end if;
  end loop;
  for f in select * from jsonb_array_elements(cur) loop
    k := (f->>'type') || ':' || (f->>'entity_type') || ':' || (f->>'entity_id');
    continue when k = any(open_keys);
    insert into app.flags (flag_key, flag_type, severity, entity_type, entity_id, project_id, user_id, title, details)
    values (k, f->>'type', f->>'severity', f->>'entity_type', (f->>'entity_id')::bigint,
            (f->>'project_id')::bigint, (f->>'user_id')::bigint, f->>'title', f->>'details');
    open_keys := open_keys || k;
  end loop;
  return jsonb_array_length(cur);
end $$;

-- ---------- daily targets ----------
-- Open features a person is responsible for: own assignment, or module assignment when the feature has none.
create or replace function app.open_feature_ids(uid bigint) returns setof bigint
language sql stable as $$
  select f.id
  from app.work_items f
  join app.work_items m on m.id = f.parent_id
  join app.projects p on p.id = f.project_id
  where f.level = 'feature'
    and f.status in ('proposed','not_started','in_progress','blocked')
    and m.status not in ('on_hold','cancelled')
    and p.status = 'active'
    and (
      exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = uid)
      or (
        not exists (select 1 from app.assignments a join app.users u on u.id = a.user_id where a.work_item_id = f.id and u.active)
        and exists (select 1 from app.assignments a where a.work_item_id = m.id and a.user_id = uid)
      )
    )
  order by f.planned_start nulls first, f.sequence, f.id
$$;

create or replace function app.bucket_for(f app.work_items, d date) returns text
language sql immutable as $$
  select case
    when f.planned_end is not null and f.planned_end < d then 'overdue'
    when f.sent_back then 'sent_back'
    when f.planned_end = d then 'due_today'
    when f.planned_start is not null and f.planned_start <= d and f.planned_end is not null and d < f.planned_end then 'in_window'
    when f.status = 'blocked' then 'blocked'
    else null end
$$;

-- Build (or top up) a person's stored list for a date. Items are only ever added, never removed,
-- so the list stays a record of what was asked; once the log is submitted it is frozen.
create or replace function app.ensure_targets(uid bigint, d date default null) returns void
language plpgsql as $$
declare
  submitted timestamptz; have bigint[]; n_existing int; has_core boolean; has_up_next boolean;
  f app.work_items; b text; picked_ids bigint[] := '{}'; picked_b text[] := '{}'; next_id bigint; i int;
begin
  d := coalesce(d, app.app_today());
  select submitted_at into submitted from app.daily_logs where user_id = uid and date = d;
  select coalesce(array_agg(work_item_id), '{}'), count(*) into have, n_existing
  from app.daily_targets where user_id = uid and date = d and work_item_id is not null;
  if submitted is not null and n_existing > 0 then return; end if;

  for f in select w.* from app.open_feature_ids(uid) with ordinality x(id, ord) join app.work_items w on w.id = x.id order by x.ord loop
    b := app.bucket_for(f, d);
    if b is not null then picked_ids := picked_ids || f.id; picked_b := picked_b || b; end if;
  end loop;

  has_core := exists (select 1 from unnest(picked_b) x where x <> 'blocked')
           or exists (select 1 from app.daily_targets where user_id = uid and date = d and work_item_id is not null
                      and bucket not in ('blocked','up_next'));
  has_up_next := exists (select 1 from app.daily_targets where user_id = uid and date = d and work_item_id is not null and bucket = 'up_next');
  if not has_core and not has_up_next then
    select w.id into next_id
    from app.open_feature_ids(uid) x(id) join app.work_items w on w.id = x.id
    where app.bucket_for(w, d) is null and w.status <> 'blocked'
    order by w.planned_start nulls last, w.sequence, w.id
    limit 1;
    if next_id is not null then picked_ids := picked_ids || next_id; picked_b := picked_b || 'up_next'::text; end if;
  end if;

  for i in 1..coalesce(cardinality(picked_ids), 0) loop
    continue when picked_ids[i] = any(have);
    insert into app.daily_targets (user_id, date, work_item_id, bucket) values (uid, d, picked_ids[i], picked_b[i]);
    have := have || picked_ids[i];
  end loop;
end $$;

-- Today's lists for everyone (7:00 AM job).
create or replace function app.generate_all_targets(d date default null) returns int
language plpgsql as $$
declare u bigint; n int := 0;
begin
  d := coalesce(d, app.app_today());
  if not app.is_wd(d, null) then return 0; end if;
  for u in select id from app.users where active and role = 'workforce' order by id loop
    perform app.ensure_targets(u, d);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A day's log can be edited until 11:00 AM on the next working day.
create or replace function app.log_locked(d date) returns boolean
language plpgsql stable as $$
declare t date := app.app_today(); deadline date;
begin
  if d >= t then return false; end if;
  deadline := app.next_wd(d, null);
  if t < deadline then return false; end if;
  if t > deadline then return true; end if;
  return app.minutes_now() >= 11 * 60;
end $$;

-- Everything the "Today" screen needs for one person and date.
create or replace function app.day_view(uid bigint, d date) returns jsonb
language plpgsql stable as $$
declare targets jsonb; lg app.daily_logs; entries jsonb := '[]';
begin
  select coalesce(jsonb_agg(x.j order by x.ord, x.pe nulls last, x.id), '[]') into targets from (
    select t.id, f.planned_end pe,
      array_position(array['overdue','sent_back','due_today','in_window','blocked','up_next','adhoc'], t.bucket) ord,
      jsonb_build_object(
        'id', t.id, 'date', t.date, 'bucket', t.bucket, 'adhoc_title', t.adhoc_title, 'work_item_id', t.work_item_id,
        'feature_name', f.name, 'status', f.status, 'size', f.size, 'planned_start', f.planned_start, 'planned_end', f.planned_end,
        'requires_proof', f.requires_proof, 'sent_back', f.sent_back,
        'module_id', f.parent_id, 'module_name', m.name, 'project_id', p.id, 'project_name', p.name, 'company_name', c.name,
        'created_by_name', cb.name,
        'sent_back_reason', (select s.reason from app.submissions s where s.work_item_id = f.id and s.decision = 'rejected' order by s.id desc limit 1),
        'partners', (select string_agg(u.name, ', ' order by a.id) from app.assignments a join app.users u on u.id = a.user_id
                     where a.work_item_id = f.id and a.user_id <> t.user_id and u.active)
      ) j
    from app.daily_targets t
    left join app.work_items f on f.id = t.work_item_id
    left join app.work_items m on m.id = f.parent_id
    left join app.projects p on p.id = f.project_id
    left join app.companies c on c.id = p.company_id
    left join app.users cb on cb.id = t.created_by
    where t.user_id = uid and t.date = d
  ) x;
  select * into lg from app.daily_logs where user_id = uid and date = d;
  if lg.id is not null then
    select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('feature_name', f.name, 'project_name', p.name) order by e.id), '[]')
      into entries
    from app.log_entries e left join app.work_items f on f.id = e.work_item_id left join app.projects p on p.id = f.project_id
    where e.log_id = lg.id;
  end if;
  return jsonb_build_object(
    'date', d,
    'is_working_day', app.is_wd(d, null),
    'locked', app.log_locked(d),
    'targets', targets,
    'log', case when lg.id is null then null else to_jsonb(lg) end,
    'entries', entries);
end $$;

-- ---------- scheduled jobs ----------
create or replace function app.take_snapshots(on_ date default null) returns void
language plpgsql as $$
declare r record;
begin
  on_ := coalesce(on_, app.app_today());
  for r in select id, progress_pct from app.projects where status = 'active' loop
    insert into app.progress_snapshots (date, entity_type, entity_id, progress_pct, time_pct)
    values (on_, 'project', r.id, r.progress_pct, (app.schedule_facts('project', r.id, on_)->>'time_pct')::double precision)
    on conflict (date, entity_type, entity_id) do update set progress_pct = excluded.progress_pct, time_pct = excluded.time_pct;
  end loop;
  for r in select id, progress_pct from app.work_items where level = 'module' and status <> 'cancelled' loop
    insert into app.progress_snapshots (date, entity_type, entity_id, progress_pct, time_pct)
    values (on_, 'module', r.id, r.progress_pct, (app.schedule_facts('module', r.id, on_)->>'time_pct')::double precision)
    on conflict (date, entity_type, entity_id) do update set progress_pct = excluded.progress_pct, time_pct = excluded.time_pct;
  end loop;
end $$;

create or replace function app.log_reminders(on_ date default null) returns int
language plpgsql as $$
declare ids bigint[];
begin
  on_ := coalesce(on_, app.app_today());
  if not app.is_wd(on_, null) then return 0; end if;
  select coalesce(array_agg(u.id), '{}') into ids from app.users u
  where u.active and u.role = 'workforce'
    and exists (select 1 from app.daily_targets t where t.user_id = u.id and t.date = on_)
    and not exists (select 1 from app.daily_logs l where l.user_id = u.id and l.date = on_ and l.submitted_at is not null);
  perform app.notify(ids, 'reminder', 'Log today''s work before you leave', 'Your log can be edited until 11:00 AM tomorrow.', '/');
  return cardinality(ids);
end $$;

create or replace function app.job_morning() returns void language plpgsql as $$
begin perform app.refresh_flags(); perform app.generate_all_targets(); end $$;
create or replace function app.job_reminders() returns void language plpgsql as $$
begin perform app.log_reminders(); end $$;
create or replace function app.job_hourly() returns void language plpgsql as $$
begin perform app.refresh_flags(); end $$;
create or replace function app.job_nightly() returns void language plpgsql as $$
begin perform app.take_snapshots(); perform app.refresh_flags(); end $$;
