-- =====================================================================
-- Core helpers: errors, input checks, working-day calendar, planning engine
-- =====================================================================

-- Raise an error the web app shows as-is. The HTTP-like status travels in the hint.
create or replace function app.fail(status int, msg text) returns void
language plpgsql as $$
begin
  raise exception using message = msg, errcode = 'P0001', hint = status::text;
end $$;

create or replace function app.setting(k text, fallback text default null) returns text
language sql stable as $$
  select coalesce((select value from app.settings where key = k), fallback)
$$;

-- Number(getSetting(k, d)) || d
create or replace function app.setting_num(k text, d numeric) returns numeric
language plpgsql stable as $$
declare v numeric;
begin
  begin
    v := nullif(trim(app.setting(k, d::text)), '')::numeric;
  exception when others then v := null;
  end;
  return coalesce(nullif(v, 0), d);
end $$;

create or replace function app.set_setting(k text, v text) returns void
language sql as $$
  insert into app.settings (key, value) values (k, v)
  on conflict (key) do update set value = excluded.value
$$;

create or replace function app.app_tz() returns text
language sql stable as $$ select app.setting('timezone', 'Asia/Kolkata') $$;

-- "now" can be pinned for tests with: set app.now = '2026-10-07 10:00+05:30'
create or replace function app.app_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now())
$$;

create or replace function app.app_today() returns date
language sql stable as $$ select (app.app_now() at time zone app.app_tz())::date $$;

create or replace function app.minutes_now() returns int
language sql stable as $$
  select (extract(hour from (app.app_now() at time zone app.app_tz())) * 60
        + extract(minute from (app.app_now() at time zone app.app_tz())))::int
$$;

-- A timestamp's calendar date in the app timezone.
create or replace function app.local_date(t timestamptz) returns date
language sql stable as $$ select case when t is null then null else (t at time zone app.app_tz())::date end $$;

-- 'Mon, 5 Oct' (matches the en-IN format the web app uses)
create or replace function app.fd(d date) returns text
language sql immutable as $$
  select case when d is null then 'no date'
    else to_char(d, 'Dy') || ', ' || extract(day from d)::int || ' ' ||
         case extract(month from d)::int when 9 then 'Sept' else to_char(d, 'Mon') end
  end
$$;

create or replace function app.trim_ws(s text) returns text
language sql immutable as $$ select regexp_replace(coalesce(s, ''), '^\s+|\s+$', '', 'g') $$;

-- ---------- input checks (mirror the server's str/int/bool/date helpers) ----------
create or replace function app.jtext(v jsonb) returns text
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null else v #>> '{}' end
$$;

create or replace function app.v_str(v jsonb, max_len int default 2000, required boolean default false, fname text default 'This field')
returns text language plpgsql as $$
declare s text := app.trim_ws(app.jtext(v));
begin
  if required and s = '' then perform app.fail(400, fname || ' is required.'); end if;
  if length(s) > max_len then perform app.fail(400, fname || ' must be ' || max_len || ' characters or fewer.'); end if;
  return nullif(s, '');
end $$;

create or replace function app.v_int(v jsonb, fname text default 'Value', min_v numeric default null, max_v numeric default null, required boolean default false)
returns int language plpgsql as $$
declare
  t text := app.jtext(v);
  n numeric;
  bad text := fname || ' must be a whole number' ||
    case when min_v is not null then ' from ' || min_v else '' end ||
    case when max_v is not null then ' to ' || max_v else '' end || '.';
begin
  if t is null or t = '' then
    if required then perform app.fail(400, fname || ' is required.'); end if;
    return null;
  end if;
  if jsonb_typeof(v) = 'boolean' then n := case when t = 'true' then 1 else 0 end;
  else
    begin
      n := trim(t)::numeric;
    exception when others then
      perform app.fail(400, bad);
    end;
  end if;
  if n <> trunc(n) or (min_v is not null and n < min_v) or (max_v is not null and n > max_v) then
    perform app.fail(400, bad);
  end if;
  return n::int;
end $$;

create or replace function app.v_bool(v jsonb) returns boolean
language sql immutable as $$
  select coalesce(v in ('true'::jsonb, '1'::jsonb, '"1"'::jsonb, '"true"'::jsonb), false)
$$;

-- JavaScript truthiness of a JSON value (for flags like "submit").
create or replace function app.js_truthy(v jsonb) returns boolean
language sql immutable as $$
  select case
    when v is null then false
    when jsonb_typeof(v) = 'null' then false
    when jsonb_typeof(v) = 'boolean' then v = 'true'::jsonb
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric <> 0
    when jsonb_typeof(v) = 'string' then (v #>> '{}') <> ''
    else true end
$$;

create or replace function app.is_valid_date(s text) returns boolean
language plpgsql immutable as $$
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(s::date, 'YYYY-MM-DD') = s;
exception when others then
  return false;
end $$;

create or replace function app.v_date(v jsonb, fname text, required boolean default false) returns date
language plpgsql as $$
declare s text := app.jtext(v);
begin
  if s is null or s = '' or (jsonb_typeof(v) = 'boolean' and s = 'false') then
    if required then perform app.fail(400, fname || ' is required.'); end if;
    return null;
  end if;
  if not app.is_valid_date(s) then perform app.fail(400, fname || ' must be a valid date.'); end if;
  return s::date;
end $$;

create or replace function app.v_size(v text, fname text default 'Size') returns text
language plpgsql as $$
begin
  if v is null or v not in ('small','medium','large') then
    perform app.fail(400, fname || ' must be small, medium or large.');
  end if;
  return v;
end $$;

-- ---------- working-day calendar ----------
-- Weekly days off for a venture (null = the group default).
create or replace function app.cal_offs(cid bigint) returns int[]
language sql stable as $$
  select coalesce(array(
    select trim(x)::int
    from unnest(string_to_array(
      case when cid is null then app.setting('default_weekly_offs', '0')
           else (select weekly_offs from app.companies where id = cid) end, ',')) x
    where trim(x) ~ '^[0-6]$'
  ), '{}')
$$;

create or replace function app.is_wd(d date, cid bigint) returns boolean
language sql stable as $$
  select not (extract(dow from d)::int = any(app.cal_offs(cid)))
     and (cid is null or not exists (select 1 from app.holidays h where h.company_id = cid and h.date = d))
$$;

create or replace function app.next_wd(d date, cid bigint, include_self boolean default false) returns date
language plpgsql stable as $$
declare x date := case when include_self then d else d + 1 end; i int := 0;
begin
  if d is null then return null; end if;
  while i < 400 and not app.is_wd(x, cid) loop x := x + 1; i := i + 1; end loop;
  return x;
end $$;

create or replace function app.prev_wd(d date, cid bigint, include_self boolean default false) returns date
language plpgsql stable as $$
declare x date := case when include_self then d else d - 1 end; i int := 0;
begin
  if d is null then return null; end if;
  while i < 400 and not app.is_wd(x, cid) loop x := x - 1; i := i + 1; end loop;
  return x;
end $$;

-- The date on which n working days starting at start (inclusive) are used up.
create or replace function app.add_wd(start date, n numeric, cid bigint) returns date
language plpgsql stable as $$
declare d date := app.next_wd(start, cid, true); left_ int := greatest(1, round(n)::int) - 1;
begin
  while left_ > 0 loop d := app.next_wd(d, cid); left_ := left_ - 1; end loop;
  return d;
end $$;

-- Working days in [a, b], inclusive. 0 if b < a.
create or replace function app.wd_between(a date, b date, cid bigint) returns int
language plpgsql stable as $$
declare offs int[]; n int;
begin
  if a is null or b is null or b < a then return 0; end if;
  offs := app.cal_offs(cid);
  select count(*) into n
  from generate_series(a, least(b, a + 3699), interval '1 day') g(d)
  where not (extract(dow from g.d)::int = any(offs))
    and (cid is null or not exists (select 1 from app.holidays h where h.company_id = cid and h.date = g.d::date));
  return n;
end $$;

-- Share of working time elapsed (0-100), counting today as elapsed.
create or replace function app.time_pct(s date, e date, cid bigint, on_ date) returns double precision
language plpgsql stable as $$
declare total int;
begin
  if s is null or e is null then return 0; end if;
  if on_ < s then return 0; end if;
  if on_ >= e then return 100; end if;
  total := app.wd_between(s, e, cid);
  if total = 0 then return 100; end if;
  return least(100, app.wd_between(s, on_, cid)::double precision / total * 100);
end $$;

-- ---------- small shared helpers ----------
create or replace function app.audit(p_project bigint, p_entity text, p_entity_id bigint, p_action text, p_details text, p_actor bigint)
returns void language sql as $$
  insert into app.audit_log (project_id, entity, entity_id, action, details, actor_id)
  values (p_project, p_entity, p_entity_id, p_action, p_details, p_actor)
$$;

create or replace function app.notify(uids bigint[], p_type text, p_title text, p_body text default null, p_link text default null)
returns void language sql as $$
  insert into app.notifications (user_id, type, title, body, link)
  select u, p_type, p_title, p_body, p_link
  from (select distinct u from unnest(uids) u where u is not null) x
$$;

create or replace function app.admin_ids() returns bigint[]
language sql stable as $$
  select coalesce(array(select id from app.users where role = 'admin' and active order by id), '{}')
$$;

create or replace function app.user_names(ids bigint[]) returns text
language sql stable as $$
  select coalesce((select string_agg(name, ', ' order by id) from app.users where id = any(ids)), 'nobody')
$$;

create or replace function app.user_list(ids bigint[]) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email) order by id), '[]')
  from app.users where id = any(ids)
$$;

-- ---------- planning engine ----------
create or replace function app.company_of_project(pid bigint) returns bigint
language sql stable as $$ select company_id from app.projects where id = pid $$;

create or replace function app.weight_for(cid bigint, sz text) returns int
language sql stable as $$
  select coalesce(
    (select case sz when 'small' then weight_small when 'medium' then weight_medium when 'large' then weight_large end
     from app.companies where id = cid),
    case sz when 'small' then 1 when 'medium' then 2 when 'large' then 4 else 1 end)
$$;

create or replace function app.assignee_ids(item bigint) returns bigint[]
language sql stable as $$
  select coalesce(array(
    select a.user_id from app.assignments a join app.users u on u.id = a.user_id
    where a.work_item_id = item and u.active order by a.is_lead desc, a.user_id), '{}')
$$;

-- People responsible for a feature: its own assignees, else its module's.
create or replace function app.effective_assignees(feature bigint) returns bigint[]
language plpgsql stable as $$
declare own bigint[] := app.assignee_ids(feature); par bigint;
begin
  select parent_id into par from app.work_items where id = feature;
  if cardinality(own) > 0 or par is null then return own; end if;
  return app.assignee_ids(par);
end $$;

create or replace function app.is_assigned(uid bigint, item bigint) returns boolean
language sql stable as $$
  select exists (select 1 from app.assignments where work_item_id = item and user_id = uid)
$$;

create or replace function app.can_see(uid bigint, admin boolean, item bigint) returns boolean
language plpgsql stable as $$
declare it app.work_items;
begin
  select * into it from app.work_items where id = item;
  if it.id is null then return false; end if;
  if admin then return true; end if;
  if it.level = 'module' then
    if app.is_assigned(uid, it.id) then return true; end if;
    return exists (select 1 from app.assignments a join app.work_items f on f.id = a.work_item_id
                   where f.parent_id = it.id and a.user_id = uid);
  end if;
  return app.is_assigned(uid, it.id) or app.is_assigned(uid, it.parent_id);
end $$;

create or replace function app.can_work(uid bigint, admin boolean, item bigint) returns boolean
language plpgsql stable as $$
declare par bigint;
begin
  if admin then return true; end if;
  select parent_id into par from app.work_items where id = item;
  return uid = any(app.effective_assignees(item)) or app.is_assigned(uid, par);
end $$;

create or replace function app.visible_project_ids(uid bigint, admin boolean) returns bigint[]
language sql stable as $$
  select case when admin then coalesce(array(select id from app.projects order by id), '{}')
  else coalesce(array(select distinct w.project_id from app.assignments a join app.work_items w on w.id = a.work_item_id
                      where a.user_id = uid), '{}') end
$$;

-- Why a module cannot be assigned yet, or null when it is ready.
create or replace function app.module_not_ready(mid bigint) returns text
language plpgsql stable as $$
declare m app.work_items; n int;
begin
  select * into m from app.work_items where id = mid;
  if m.start_date is null or m.duration_days is null then
    return 'Set a start date and duration before assigning this module.';
  end if;
  select count(*) into n from app.work_items where parent_id = mid and status not in ('proposed','cancelled');
  if n = 0 then return 'List at least one feature before assigning this module.'; end if;
  return null;
end $$;

-- Compute the module end date and give every feature a planned window inside it.
-- One lane per lead person (first feature assignee, else the module team); lanes run in parallel.
create or replace function app.plan_module(mid bigint) returns void
language plpgsql as $$
declare
  m app.work_items; cid bigint; v_end date; v_start date; total int;
  mod_assignees bigint[]; own bigint[]; f app.work_items;
  ids bigint[] := '{}'; ws int[] := '{}'; ks text[] := '{}'; lanes text[] := '{}';
  k text; lane text; sumw numeric; cnt int; j int; i int; used int; days int; cur date; p_end date;
begin
  select * into m from app.work_items where id = mid;
  if m.id is null then return; end if;
  cid := app.company_of_project(m.project_id);
  if m.start_date is null or m.duration_days is null then
    update app.work_items set end_date = null where id = mid;
    return;
  end if;
  v_end := app.add_wd(m.start_date, m.duration_days, cid);
  update app.work_items set end_date = v_end, original_end_date = coalesce(original_end_date, v_end) where id = mid;

  mod_assignees := app.assignee_ids(mid);
  for f in select * from app.work_items where parent_id = mid and status <> 'cancelled' order by sequence, id loop
    if f.manual_dates and f.planned_start is not null and f.planned_end is not null then continue; end if;
    own := app.assignee_ids(f.id);
    k := case when cardinality(own) > 0 then 'u' || own[1] when cardinality(mod_assignees) > 0 then 'team' else 'unassigned' end;
    ids := ids || f.id; ws := ws || f.weight; ks := ks || k;
    if not (k = any(lanes)) then lanes := lanes || k; end if;
  end loop;
  if cardinality(ids) = 0 then return; end if;

  v_start := app.next_wd(m.start_date, cid, true);
  total := coalesce(nullif(app.wd_between(v_start, v_end, cid), 0), 1);
  foreach lane in array lanes loop
    sumw := 0; cnt := 0;
    for i in 1..cardinality(ids) loop
      if ks[i] = lane then sumw := sumw + ws[i]; cnt := cnt + 1; end if;
    end loop;
    if sumw = 0 then sumw := 1; end if;
    cur := v_start; used := 0; j := 0;
    for i in 1..cardinality(ids) loop
      continue when ks[i] <> lane;
      j := j + 1;
      if j = cnt then days := greatest(1, total - used);
      else days := greatest(1, round(total * ws[i]::numeric / sumw)::int); end if;
      if used >= total then days := 1; end if;
      if cur > v_end then cur := v_end; end if;
      p_end := app.add_wd(cur, days, cid);
      if p_end > v_end then p_end := v_end; end if;
      update app.work_items set planned_start = cur, planned_end = p_end where id = ids[i];
      used := used + days;
      cur := case when p_end >= v_end then v_end else app.next_wd(p_end, cid) end;
    end loop;
  end loop;
end $$;

-- Recalculate a module's progress and status from its features.
create or replace function app.recompute_module(mid bigint) returns void
language plpgsql as $$
declare m app.work_items; w numeric; d numeric; s numeric; n int; act int; st text;
begin
  select * into m from app.work_items where id = mid;
  if m.id is null then return; end if;
  select coalesce(sum(weight),0), coalesce(sum(case when status = 'done' then weight end),0),
         coalesce(sum(case when status = 'submitted' then weight end),0), count(*),
         count(*) filter (where status in ('in_progress','submitted','blocked','done'))
    into w, d, s, n, act
  from app.work_items where parent_id = mid and status not in ('proposed','cancelled');
  st := m.status;
  if m.status not in ('on_hold','cancelled') then
    if n > 0 and d = w then st := 'done';
    elsif act > 0 then st := 'in_progress';
    else st := 'not_started'; end if;
  end if;
  update app.work_items set
    progress_pct = case when w > 0 then d / w * 100 else 0 end,
    pending_pct  = case when w > 0 then s / w * 100 else 0 end,
    status = st,
    completed_at = case when st = 'done' then coalesce(m.completed_at, app.app_now()) else null end
  where id = mid;
end $$;

create or replace function app.recompute_project(pid bigint) returns void
language sql as $$
  update app.projects p set
    progress_pct = coalesce(x.d / nullif(x.w, 0), 0),
    pending_pct  = coalesce(x.s / nullif(x.w, 0), 0)
  from (select coalesce(sum(weight),0)::double precision w,
               coalesce(sum(weight * progress_pct),0) d,
               coalesce(sum(weight * pending_pct),0) s
        from app.work_items where project_id = pid and level = 'module' and status <> 'cancelled') x
  where p.id = pid
$$;

-- Re-plan and re-roll a whole project. Cheap: a project has tens of items.
create or replace function app.recalc_project(pid bigint) returns void
language plpgsql as $$
declare mid bigint;
begin
  for mid in select id from app.work_items where project_id = pid and level = 'module' order by id loop
    perform app.plan_module(mid);
    perform app.recompute_module(mid);
  end loop;
  perform app.recompute_project(pid);
end $$;

create or replace function app.recalc_all() returns void
language plpgsql as $$
declare pid bigint;
begin
  for pid in select id from app.projects order by id loop perform app.recalc_project(pid); end loop;
end $$;

-- Project window = earliest module start -> latest module end.
create or replace function app.project_window(pid bigint, out w_start date, out w_end date)
language sql stable as $$
  select min(start_date), max(end_date) from app.work_items
  where project_id = pid and level = 'module' and status <> 'cancelled' and start_date is not null
$$;

-- % of a module's weight the plan says should be finished before on_ (features whose window has closed).
create or replace function app.expected_module_pct(mid bigint, on_ date) returns double precision
language sql stable as $$
  select case when coalesce(sum(weight),0) = 0 then 0
    else coalesce(sum(case when planned_end < on_ then weight end),0)::double precision / sum(weight) * 100 end
  from app.work_items where parent_id = mid and status not in ('proposed','cancelled')
$$;

create or replace function app.expected_project_pct(pid bigint, on_ date) returns double precision
language sql stable as $$
  select case when coalesce(sum(weight),0) = 0 then 0
    else sum(weight * app.expected_module_pct(id, on_)) / sum(weight) end
  from app.work_items where project_id = pid and level = 'module' and status <> 'cancelled'
$$;

-- Schedule and health facts for admin views.
-- Health compares work done or awaiting review with what the plan says should be finished by today:
-- green >= 90% of expected, amber >= 70%, red below that or past the end date.
create or replace function app.schedule_facts(kind text, item bigint, on_ date default null) returns jsonb
language plpgsql stable as $$
declare
  cid bigint; s date; e date; is_done boolean; expected double precision := 0; actual double precision := 0;
  t double precision; h text; p app.projects; w app.work_items; ratio double precision; dl int;
begin
  on_ := coalesce(on_, app.app_today());
  if kind = 'project' then
    select * into p from app.projects where id = item;
    cid := p.company_id;
    select w_start, w_end into s, e from app.project_window(item);
    is_done := p.status = 'completed' or (p.progress_pct >= 99.999 and e is not null);
    expected := app.expected_project_pct(item, on_);
    actual := p.progress_pct + p.pending_pct;
  else
    select * into w from app.work_items where id = item;
    cid := app.company_of_project(w.project_id);
    if kind = 'module' then
      s := w.start_date; e := w.end_date; is_done := w.status = 'done';
      expected := app.expected_module_pct(item, on_);
      actual := w.progress_pct + w.pending_pct;
    else
      s := w.planned_start; e := w.planned_end; is_done := w.status = 'done';
    end if;
  end if;
  t := app.time_pct(s, e, cid, on_);
  if kind = 'feature' then
    h := case when is_done then 'done' when w.status = 'submitted' then 'none' when e is not null and on_ > e then 'red' else 'none' end;
  elsif is_done then h := 'done';
  elsif e is null then h := 'none';
  elsif on_ > e then h := 'red';
  elsif expected <= 0 then h := case when t < 10 then 'none' else 'green' end;
  else
    ratio := actual / expected;
    h := case when ratio >= 0.9 then 'green' when ratio >= 0.7 then 'amber' else 'red' end;
  end if;
  if e is null then dl := null;
  elsif on_ > e then dl := -app.wd_between(e + 1, on_, cid);
  else dl := app.wd_between(on_, e, cid); end if;
  return jsonb_build_object(
    'start_date', s, 'end_date', e,
    'time_pct', (round((t * 10)::numeric) / 10)::double precision,
    'expected_pct', (round((expected * 10)::numeric) / 10)::double precision,
    'health', h, 'days_left', dl);
end $$;
