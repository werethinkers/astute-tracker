-- =====================================================================
-- Routes: admin screens, daily work and logs, notifications, people
-- =====================================================================

create or replace function app.flag_json(f app.flags) returns jsonb
language sql stable as $$
  select to_jsonb(f) || jsonb_build_object(
    'project_name', (select name from app.projects where id = f.project_id),
    'user_name', (select name from app.users where id = f.user_id),
    'ack_name', (select name from app.users where id = f.acknowledged_by))
$$;

-- Severity, then type, then entity (the order admins see flags in).
create or replace function app.flag_rank(f app.flags) returns int[]
language sql immutable as $$
  select array[
    case f.severity when 'red' then 0 else 1 end,
    case f.flag_type when 'overdue' then 0 when 'blocked_long' then 1 when 'behind' then 2 when 'review_waiting' then 3
      when 'stalled' then 4 when 'overload' then 5 when 'unassigned' then 6 when 'missing_logs' then 7 else 8 end,
    case f.entity_type when 'project' then 0 when 'module' then 1 else 2 end]
$$;

create or replace function app.project_cards() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.card order by x.name), '[]') from (
    select p.name, jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'company_id', p.company_id, 'company_name', c.name,
        'target_end_date', p.target_end_date, 'progress_pct', p.progress_pct, 'pending_pct', p.pending_pct)
      || facts
      || jsonb_build_object(
        'open_flags', (select count(*) from app.flags f where f.cleared_at is null and f.project_id = p.id),
        'red_flags', (select count(*) from app.flags f where f.cleared_at is null and f.project_id = p.id and f.severity = 'red'),
        'features', (select count(*) from app.work_items w where w.project_id = p.id and w.level = 'feature' and w.status not in ('proposed','cancelled')),
        'features_done', (select count(*) from app.work_items w where w.project_id = p.id and w.level = 'feature' and w.status = 'done'),
        'features_submitted', (select count(*) from app.work_items w where w.project_id = p.id and w.level = 'feature' and w.status = 'submitted'),
        'people', (select count(distinct a.user_id) from app.assignments a join app.work_items w on w.id = a.work_item_id where w.project_id = p.id),
        'late_vs_target', coalesce(p.target_end_date is not null and (facts->>'end_date') is not null and (facts->>'end_date')::date > p.target_end_date, false)) card
    from app.projects p join app.companies c on c.id = p.company_id
    cross join lateral (select app.schedule_facts('project', p.id) facts) sf
    where p.status in ('active','on_hold')
  ) x
$$;

create or replace function app.missing_logs(d date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name), '[]')
  from app.users u
  where u.active and u.role = 'workforce' and app.local_date(u.created_at) <= d
    and exists (select 1 from app.assignments a join app.work_items w on w.id = a.work_item_id
                where a.user_id = u.id and w.status not in ('done','cancelled'))
    and not exists (select 1 from app.daily_logs l where l.user_id = u.id and l.date = d and l.submitted_at is not null)
$$;

create or replace function app.r_overview(me app.users) returns jsonb
language plpgsql as $$
declare on_ date := app.app_today(); cards jsonb; yesterday date;
begin
  perform app.require_admin(me);
  cards := app.project_cards();
  yesterday := app.prev_wd(on_, null);
  return jsonb_build_object(
    'today', on_, 'yesterday', yesterday,
    'counts', jsonb_build_object(
      'at_risk_projects', (select count(*) from jsonb_array_elements(cards) c where c->>'status' = 'active' and c->>'health' in ('red','amber')),
      'overdue_features', (select count(*) from app.flags where cleared_at is null and flag_type = 'overdue' and entity_type = 'feature'),
      'reviews_waiting', (select count(*) from app.work_items where status = 'submitted'),
      'proposed_features', (select count(*) from app.work_items where status = 'proposed'),
      'missing_logs', jsonb_array_length(app.missing_logs(yesterday))),
    'flags', (select coalesce(jsonb_agg(app.flag_json(f) order by (f.acknowledged_at is not null), app.flag_rank(f), f.raised_at, f.id), '[]')
              from app.flags f where f.id in (select g.id from app.flags g where g.cleared_at is null
                    order by (g.acknowledged_at is not null), app.flag_rank(g), g.raised_at, g.id limit 200)),
    'ventures', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                   'projects', (select coalesce(jsonb_agg(x order by x->>'name'), '[]') from jsonb_array_elements(cards) x where (x->>'company_id')::bigint = c.id))
                 order by c.name), '[]') from app.companies c));
end $$;

create or replace function app.r_flags(me app.users, cleared boolean) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  if cleared then
    return jsonb_build_object('flags', (select coalesce(jsonb_agg(app.flag_json(f) order by f.cleared_at desc, f.id desc), '[]')
      from app.flags f where f.id in (select g.id from app.flags g where g.cleared_at is not null order by g.cleared_at desc, g.id desc limit 300)));
  end if;
  return jsonb_build_object('flags', (select coalesce(jsonb_agg(app.flag_json(f) order by app.flag_rank(f), f.raised_at, f.id), '[]')
    from app.flags f where f.id in (select g.id from app.flags g where g.cleared_at is null order by app.flag_rank(g), g.raised_at, g.id limit 300)));
end $$;

create or replace function app.r_flag_ack(me app.users, fid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare f app.flags; note text;
begin
  perform app.require_admin(me);
  select * into f from app.flags where id = fid;
  if f.id is null then perform app.fail(404, 'Flag not found.'); end if;
  note := app.v_str(body->'note', 1000, true, 'Note');
  update app.flags set acknowledged_by = me.id, ack_note = note, acknowledged_at = now() where id = fid;
  perform app.audit(f.project_id, 'flag', fid, 'acknowledged', f.title || ': ' || note, me.id);
  return '{"ok":true}';
end $$;

create or replace function app.r_portfolio(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object(
    'projects', app.project_cards(),
    'closed', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'company_name', c.name,
                 'company_id', p.company_id, 'progress_pct', p.progress_pct) order by p.id), '[]')
               from app.projects p join app.companies c on c.id = p.company_id where p.status in ('completed','cancelled')),
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from app.companies));
end $$;

-- Who is doing what on a day.
create or replace function app.r_team(me app.users, d date) returns jsonb
language plpgsql as $$
declare monday date; u app.users; people jsonb := '[]'; targets jsonb; lg app.daily_logs; worked int; hours_today double precision;
  hours_week double precision; in_progress jsonb; flags jsonb;
begin
  perform app.require_admin(me);
  d := coalesce(d, app.app_today());
  monday := d;
  while extract(dow from monday) <> 1 and monday > d - 7 loop monday := monday - 1; end loop;
  if d = app.app_today() then
    for u in select * from app.users where active and role = 'workforce' order by name loop perform app.ensure_targets(u.id, d); end loop;
  end if;
  for u in select * from app.users where active and role = 'workforce' order by name loop
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'bucket', t.bucket, 'work_item_id', t.work_item_id, 'adhoc_title', t.adhoc_title,
              'name', f.name, 'status', f.status, 'project_name', p.name) order by t.id), '[]')
      into targets
    from app.daily_targets t left join app.work_items f on f.id = t.work_item_id left join app.projects p on p.id = f.project_id
    where t.user_id = u.id and t.date = d;
    lg := null;
    select * into lg from app.daily_logs where user_id = u.id and date = d;
    select count(*) into worked from app.daily_targets t
    where t.user_id = u.id and t.date = d and lg.id is not null and exists (
      select 1 from app.log_entries e where e.log_id = lg.id
        and ((t.work_item_id is not null and e.work_item_id = t.work_item_id) or e.target_id = t.id));
    select coalesce(sum(hours), 0) into hours_today from app.log_entries where log_id = lg.id;
    select coalesce(sum(e.hours), 0) into hours_week from app.log_entries e join app.daily_logs l on l.id = e.log_id
    where l.user_id = u.id and l.date between monday and d;
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status, 'planned_end', f.planned_end, 'project_name', p.name)
              order by f.planned_end nulls first, f.id), '[]')
      into in_progress
    from app.work_items f join app.projects p on p.id = f.project_id
    where f.level = 'feature' and f.status in ('in_progress','blocked','submitted')
      and (exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = u.id)
        or (not exists (select 1 from app.assignments a where a.work_item_id = f.id)
            and exists (select 1 from app.assignments a where a.work_item_id = f.parent_id and a.user_id = u.id)));
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'flag_type', f.flag_type, 'severity', f.severity, 'title', f.title)
              order by case f.severity when 'red' then 0 else 1 end, f.id), '[]')
      into flags
    from app.flags f where f.cleared_at is null and f.user_id = u.id;
    people := people || jsonb_build_array(jsonb_build_object(
      'id', u.id, 'name', u.name, 'email', u.email, 'title', u.title,
      'targets', jsonb_array_length(targets), 'targets_worked', worked,
      'overdue_targets', (select count(*) from jsonb_array_elements(targets) t where t->>'bucket' = 'overdue'),
      'target_list', targets,
      'log_status', case when lg.submitted_at is not null then 'submitted' when lg.id is not null then 'draft' else 'none' end,
      'hours_today', hours_today, 'hours_week', hours_week, 'in_progress', in_progress, 'flags', flags));
  end loop;
  return jsonb_build_object('date', d, 'is_working_day', app.is_wd(d, null), 'week_start', monday, 'people', people);
end $$;

create or replace function app.r_person(me app.users, uid bigint) returns jsonb
language plpgsql as $$
declare
  u app.users; on_ date := app.app_today(); days date[] := '{}'; x date; created date; past date[]; feats jsonb;
  submitted_days date[]; log_comp int; t_total int := 0; t_worked int := 0; n_t int; n_w int;
begin
  perform app.require_admin(me);
  select * into u from app.users where id = uid;
  if u.id is null then perform app.fail(404, 'Person not found.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'status', f.status, 'size', f.size, 'planned_start', f.planned_start, 'planned_end', f.planned_end,
      'module_name', m.name, 'project_name', p.name, 'project_id', p.id, 'company_name', c.name,
      'last_log', (select max(l.date) from app.log_entries e join app.daily_logs l on l.id = e.log_id where e.work_item_id = f.id and l.user_id = uid),
      'completed_at', f.completed_at,
      'late', f.status not in ('done','submitted') and f.planned_end is not null and f.planned_end < on_)
      order by case f.status when 'done' then 1 else 0 end, f.planned_end nulls first, f.id), '[]')
    into feats
  from app.work_items f join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id join app.companies c on c.id = p.company_id
  where f.level = 'feature' and f.status <> 'cancelled'
    and (exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = uid)
      or (not exists (select 1 from app.assignments a where a.work_item_id = f.id)
          and exists (select 1 from app.assignments a where a.work_item_id = f.parent_id and a.user_id = uid)));

  -- Last 20 working days: log compliance and target completion.
  created := app.local_date(u.created_at);
  x := app.prev_wd(on_, null, true);
  while cardinality(days) < 20 and x >= created loop days := days || x; x := app.prev_wd(x, null); end loop;
  past := array(select d from unnest(days) d where d < on_);
  submitted_days := array(select date from (select date from app.daily_logs where user_id = uid order by date desc limit 30) l
                          where exists (select 1 from app.daily_logs l2 where l2.user_id = uid and l2.date = l.date and l2.submitted_at is not null));
  if cardinality(past) > 0 then
    log_comp := round((select count(*) from unnest(past) d where d = any(submitted_days))::numeric / cardinality(past) * 100);
  end if;
  foreach x in array past loop
    select count(*) into n_t from app.daily_targets where user_id = uid and date = x;
    continue when n_t = 0;
    select count(*) into n_w from app.daily_targets t where t.user_id = uid and t.date = x and exists (
      select 1 from app.log_entries e join app.daily_logs l on l.id = e.log_id
      where l.user_id = uid and l.date = x and (e.work_item_id = t.work_item_id or e.target_id = t.id));
    t_total := t_total + n_t; t_worked := t_worked + n_w;
  end loop;

  return jsonb_build_object(
    'person', jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role, 'title', u.title, 'active', u.active,
      'created_at', u.created_at, 'last_login_at', (select last_sign_in_at from auth.users where id = u.auth_id)),
    'features', feats,
    'logs', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('hours', (select coalesce(sum(hours), 0) from app.log_entries e where e.log_id = l.id))
              order by l.date desc), '[]')
             from (select * from app.daily_logs where user_id = uid order by date desc limit 30) l),
    'entries', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('date', l.date, 'feature_name', f.name, 'project_name', p.name)
                 order by l.date desc, e.id), '[]')
                from app.log_entries e join app.daily_logs l on l.id = e.log_id
                left join app.work_items f on f.id = e.work_item_id left join app.projects p on p.id = f.project_id
                where l.user_id = uid and l.date >= on_ - 21),
    'submissions', (select coalesce(jsonb_agg(x.j order by x.id desc), '[]') from (
                      select s.id, jsonb_build_object('id', s.id, 'note', s.note, 'submitted_at', s.submitted_at, 'decision', s.decision,
                        'reason', s.reason, 'item_id', f.id, 'feature_name', f.name, 'project_name', p.name) j
                      from app.submissions s join app.work_items f on f.id = s.work_item_id join app.projects p on p.id = f.project_id
                      where s.submitted_by = uid order by s.id desc limit 20) x),
    'hours_by_project', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'hours', hours) order by hours desc, label), '[]') from (
                           select coalesce(p.name, e.category, 'Other work') label, sum(e.hours) hours
                           from app.log_entries e join app.daily_logs l on l.id = e.log_id
                           left join app.work_items f on f.id = e.work_item_id left join app.projects p on p.id = f.project_id
                           where l.user_id = uid and l.date >= on_ - 30 group by 1) h),
    'flags', (select coalesce(jsonb_agg(app.flag_json(f) order by app.flag_rank(f), f.id), '[]') from app.flags f where f.cleared_at is null and f.user_id = uid),
    'stats', jsonb_build_object(
      'log_compliance', log_comp,
      'target_completion', case when t_total > 0 then round(t_worked::numeric / t_total * 100) end,
      'open_features', (select count(*) from jsonb_array_elements(feats) f where f->>'status' not in ('done','cancelled')),
      'late_features', (select count(*) from jsonb_array_elements(feats) f where (f->>'late')::boolean),
      'days_measured', cardinality(past)));
end $$;

-- Heatmap: features each person has planned on each of the next N working days.
create or replace function app.r_workload(me app.users, n_req text) returns jsonb
language plpgsql as $$
declare
  n int; days date[] := '{}'; d date; people jsonb := '[]'; u app.users; cells jsonb; overdue int; f record; i int;
  act int; due int; names jsonb;
begin
  perform app.require_admin(me);
  begin n := nullif(n_req, '')::numeric::int; exception when others then n := null; end;
  n := least(greatest(coalesce(nullif(n, 0), 10), 5), 20);
  d := app.next_wd(app.app_today(), null, true);
  while cardinality(days) < n loop days := days || d; d := app.next_wd(d, null); end loop;
  for u in select * from app.users where active and role = 'workforce' order by name loop
    cells := '[]';
    for i in 1..n loop
      act := 0; due := 0; names := '[]';
      for f in
        select w.id, w.name, w.planned_start, w.planned_end from app.work_items w
        join app.work_items m on m.id = w.parent_id join app.projects p on p.id = w.project_id
        where w.level = 'feature' and w.status in ('proposed','not_started','in_progress','blocked') and p.status = 'active'
          and m.status not in ('on_hold','cancelled') and u.id = any(app.effective_assignees(w.id))
        order by w.id
      loop
        if f.planned_start is not null and f.planned_end is not null and f.planned_start <= days[i] and days[i] <= f.planned_end then
          act := act + 1; names := names || to_jsonb(f.name);
        end if;
        if f.planned_end = days[i] then due := due + 1; end if;
      end loop;
      cells := cells || jsonb_build_object('active', act, 'due', due, 'names', names);
    end loop;
    select count(*) into overdue from app.work_items w
    join app.work_items m on m.id = w.parent_id join app.projects p on p.id = w.project_id
    where w.level = 'feature' and w.status in ('proposed','not_started','in_progress','blocked') and p.status = 'active'
      and m.status not in ('on_hold','cancelled') and u.id = any(app.effective_assignees(w.id)) and w.planned_end < days[1];
    people := people || jsonb_build_array(jsonb_build_object('id', u.id, 'name', u.name, 'cells', cells, 'overdue', overdue));
  end loop;
  return jsonb_build_object('days', to_jsonb(days), 'people', people);
end $$;

create or replace function app.r_reviews(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object(
    'submissions', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'submitted_by_name', u.name, 'item_id', f.id, 'feature_name', f.name, 'size', f.size, 'requires_proof', f.requires_proof,
        'planned_end', f.planned_end, 'module_name', m.name, 'project_id', p.id, 'project_name', p.name, 'company_name', c.name,
        'rounds', (select count(*) from app.submissions s2 where s2.work_item_id = f.id),
        'files', (select coalesce(jsonb_agg(jsonb_build_object('id', sf.id, 'kind', sf.kind, 'url', sf.url, 'file_name', sf.file_name,
                    'size_bytes', sf.size_bytes) order by sf.id), '[]') from app.submission_files sf where sf.submission_id = s.id))
        order by s.submitted_at, s.id), '[]')
      from app.submissions s join app.users u on u.id = s.submitted_by join app.work_items f on f.id = s.work_item_id
      join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id join app.companies c on c.id = p.company_id
      where s.decision is null),
    'proposed', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'description', f.description, 'size', f.size, 'proposal_reason', f.proposal_reason,
        'created_at', f.created_at, 'proposed_by_name', u.name, 'module_id', m.id, 'module_name', m.name, 'module_end', m.end_date,
        'project_id', p.id, 'project_name', p.name, 'company_name', c.name,
        'module_weight', (select coalesce(sum(weight), 0) from app.work_items x where x.parent_id = m.id and x.status not in ('proposed','cancelled')))
        order by f.created_at, f.id), '[]')
      from app.work_items f join app.users u on u.id = f.proposed_by join app.work_items m on m.id = f.parent_id
      join app.projects p on p.id = f.project_id join app.companies c on c.id = p.company_id
      where f.status = 'proposed'));
end $$;

create or replace function app.r_admin_day(me app.users, q jsonb) returns jsonb
language plpgsql as $$
declare uid int; d date; u app.users;
begin
  perform app.require_admin(me);
  uid := app.v_int(q->'user_id', 'Person', null, null, true);
  d := case when app.is_valid_date(q->>'date') then (q->>'date')::date else app.app_today() end;
  select * into u from app.users where id = uid;
  if u.id is null then perform app.fail(404, 'Person not found.'); end if;
  return jsonb_build_object('person', jsonb_build_object('id', u.id, 'name', u.name)) || app.day_view(uid, d);
end $$;

create or replace function app.r_adhoc_add(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare uid int; u app.users; d date; title text;
begin
  perform app.require_admin(me);
  uid := app.v_int(body->'user_id', 'Person', null, null, true);
  select * into u from app.users where id = uid;
  if u.id is null or not u.active then perform app.fail(400, 'Choose an active person.'); end if;
  d := case when app.is_valid_date(body->>'date') then (body->>'date')::date else app.app_today() end;
  if d < app.app_today() then perform app.fail(400, 'Ad-hoc targets can only be set for today or later.'); end if;
  title := app.v_str(body->'title', 300, true, 'Task');
  insert into app.daily_targets (user_id, date, bucket, adhoc_title, created_by) values (uid, d, 'adhoc', title, me.id);
  perform app.notify(array[uid::bigint], 'adhoc',
    me.name || ' added a task for ' || case when d = app.app_today() then 'today' else d::text end, title, '/');
  return '{"ok":true}';
end $$;

create or replace function app.r_adhoc_delete(me app.users, tid bigint) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  if not exists (select 1 from app.daily_targets where id = tid and bucket = 'adhoc') then
    perform app.fail(404, 'Only ad-hoc tasks can be removed.');
  end if;
  delete from app.daily_targets where id = tid;
  return '{"ok":true}';
end $$;

create or replace function app.r_settings(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object('settings', (select jsonb_object_agg(k, app.setting(k)) from unnest(array['default_weekly_offs','min_note_chars',
    'flag_review_days','flag_blocked_days','flag_stalled_days','flag_overload_count','flag_scope_growth_pct']) k));
end $$;

create or replace function app.r_settings_update(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare spec jsonb := '{"min_note_chars":[10,500],"flag_review_days":[1,30],"flag_blocked_days":[1,30],"flag_stalled_days":[1,30],
                        "flag_overload_count":[1,50],"flag_scope_growth_pct":[5,500]}'; k text;
begin
  perform app.require_admin(me);
  if body ? 'default_weekly_offs' then
    perform app.set_setting('default_weekly_offs', array_to_string(array(
      select distinct trim(x) from unnest(string_to_array(coalesce(app.jtext(body->'default_weekly_offs'), ''), ',')) x
      where trim(x) ~ '^[0-6]$' order by 1), ','));
  end if;
  for k in select jsonb_object_keys(spec) loop
    continue when not body ? k;
    perform app.set_setting(k, app.v_int(body->k, replace(k, '_', ' '), (spec->k->>0)::int, (spec->k->>1)::int, true)::text);
  end loop;
  perform app.refresh_flags();
  perform app.audit(null, 'settings', null, 'updated', (select string_agg(x, ', ') from jsonb_object_keys(body) x), me.id);
  return '{"ok":true}';
end $$;

create or replace function app.r_recalculate(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  perform app.recalc_all();
  return jsonb_build_object('flags', app.refresh_flags());
end $$;

-- ======================= my work =======================
create or replace function app.categories() returns jsonb
language sql immutable as $$ select '["Meeting","Support","Review","Learning","Admin","Travel","Other"]'::jsonb $$;

create or replace function app.r_me_today(me app.users, q jsonb) returns jsonb
language plpgsql as $$
declare d date;
begin
  d := case when app.is_valid_date(q->>'date') then (q->>'date')::date else app.app_today() end;
  if d > app.app_today() then perform app.fail(400, 'You can only open today or earlier days.'); end if;
  if d = app.app_today() then perform app.ensure_targets(me.id, d); end if;
  return app.day_view(me.id, d) || jsonb_build_object('categories', app.categories(), 'today', app.app_today(),
    'min_note_chars', app.setting_num('min_note_chars', 30));
end $$;

create or replace function app.r_me_log(me app.users, ds text, body jsonb) returns jsonb
language plpgsql as $$
declare
  d date; v_entries jsonb; e jsonb; v_work text; v_hours numeric; total numeric := 0; v_item bigint; v_target bigint; v_cat text;
  t app.daily_targets; it app.work_items; clean jsonb := '[]'; started bigint[] := '{}'; v_submit boolean; v_blockers text;
  v_log bigint; touched bigint[] := '{}'; pid bigint; ht text;
begin
  if not app.is_valid_date(ds) then perform app.fail(400, 'Invalid date.'); end if;
  d := ds::date;
  if d > app.app_today() then perform app.fail(400, 'You cannot log work for a future day.'); end if;
  if app.log_locked(d) then perform app.fail(400, 'This log is locked. Logs can be edited until 11:00 AM on the next working day.'); end if;
  v_entries := case when jsonb_typeof(body->'entries') = 'array' then body->'entries' else '[]'::jsonb end;
  if jsonb_array_length(v_entries) > 60 then perform app.fail(400, 'Too many lines in one log.'); end if;
  for e in select * from jsonb_array_elements(v_entries) loop
    v_work := app.v_str(e->'work_done', 2000);
    ht := app.jtext(e->'hours');
    if ht is null or ht = '' or ht = 'false' or ht = '0' then v_hours := 0;
    else
      begin v_hours := trim(ht)::numeric; exception when others then v_hours := null; end;
    end if;
    continue when v_work is null and (v_hours is null or v_hours = 0);
    if v_work is null then perform app.fail(400, 'Each line with hours needs a short description of the work done.'); end if;
    if v_hours is null or not (v_hours >= 0 and v_hours <= 16) or round(v_hours * 2) <> v_hours * 2 then
      perform app.fail(400, 'Hours go in half-hour steps, up to 16 a line.');
    end if;
    total := total + v_hours;
    v_item := case when app.js_truthy(e->'work_item_id') then (e->>'work_item_id')::numeric::bigint end;
    v_target := case when app.js_truthy(e->'target_id') then (e->>'target_id')::numeric::bigint end;
    v_cat := null;
    if v_target is not null then
      t := null;
      select * into t from app.daily_targets x where x.id = v_target and x.user_id = me.id;
      if t.id is null then perform app.fail(400, 'One of the targets does not belong to you.'); end if;
      v_item := t.work_item_id;
    end if;
    if v_item is not null then
      it := null;
      select * into it from app.work_items x where x.id = v_item;
      if it.id is null or it.level <> 'feature' or not app.can_work(me.id, me.role = 'admin', v_item) then
        perform app.fail(400, 'You can only log work on features assigned to you.');
      end if;
      if it.status = 'not_started' and not (it.id = any(started)) then started := started || it.id; end if;
    elsif v_target is null then
      v_cat := case when app.categories() ? coalesce(app.jtext(e->'category'), '') then app.jtext(e->'category') else 'Other' end;
    end if;
    clean := clean || jsonb_build_object('target_id', v_target, 'work_item_id', v_item, 'category', v_cat, 'work_done', v_work, 'hours', v_hours);
  end loop;
  if total > 24 then perform app.fail(400, 'A day cannot have more than 24 hours logged.'); end if;
  v_submit := app.js_truthy(body->'submit');
  v_blockers := app.v_str(body->'blockers', 2000);
  if v_submit and jsonb_array_length(clean) = 0 then perform app.fail(400, 'Add at least one line of work before submitting the day.'); end if;

  insert into app.daily_logs (user_id, date) values (me.id, d) on conflict (user_id, date) do nothing;
  select x.id into v_log from app.daily_logs x where x.user_id = me.id and x.date = d;
  update app.daily_logs x set blockers = v_blockers, tomorrow_plan = app.v_str(body->'tomorrow_plan', 2000), updated_at = now(),
    submitted_at = case when v_submit then coalesce(x.submitted_at, now()) else x.submitted_at end
  where x.id = v_log;
  delete from app.log_entries x where x.log_id = v_log;
  insert into app.log_entries (log_id, target_id, work_item_id, category, work_done, hours)
  select v_log, (x->>'target_id')::bigint, (x->>'work_item_id')::bigint, x->>'category', x->>'work_done', (x->>'hours')::double precision
  from jsonb_array_elements(clean) x;
  foreach v_item in array started loop
    pid := null;
    update app.work_items x set status = 'in_progress', started_at = coalesce(x.started_at, app.app_now())
    where x.id = v_item and x.status = 'not_started' returning x.project_id into pid;
    if pid is not null then
      perform app.audit(pid, 'feature', v_item, 'not_started → in_progress', 'first work logged', me.id);
      if not (pid = any(touched)) then touched := touched || pid; end if;
    end if;
  end loop;
  foreach pid in array touched loop perform app.after(pid); end loop;
  return app.day_view(me.id, d) || jsonb_build_object('categories', app.categories(), 'today', app.app_today(),
    'min_note_chars', app.setting_num('min_note_chars', 30), 'saved', true);
end $$;

-- Everything assigned to me, without any judgement about lateness.
create or replace function app.r_me_work(me app.users) returns jsonb
language plpgsql as $$
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'status', f.status, 'size', f.size, 'planned_start', f.planned_start, 'planned_end', f.planned_end,
        'sent_back', f.sent_back, 'requires_proof', f.requires_proof, 'module_id', f.parent_id, 'module_name', m.name,
        'module_end', m.end_date, 'project_id', p.id, 'project_name', p.name, 'company_name', c.name) order by x.ord), '[]')
      from app.open_feature_ids(me.id) with ordinality x(id, ord)
      join app.work_items f on f.id = x.id join app.work_items m on m.id = f.parent_id
      join app.projects p on p.id = f.project_id join app.companies c on c.id = p.company_id),
    'submitted', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status, 'size', f.size,
        'planned_end', f.planned_end, 'module_name', m.name, 'project_name', p.name, 'project_id', p.id) order by f.id), '[]')
      from app.work_items f join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id
      where f.status = 'submitted' and (exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = me.id)
        or exists (select 1 from app.assignments a where a.work_item_id = f.parent_id and a.user_id = me.id))),
    'done', (select coalesce(jsonb_agg(x.j order by x.completed_at desc nulls last), '[]') from (
        select f.completed_at, jsonb_build_object('id', f.id, 'name', f.name, 'completed_at', f.completed_at, 'module_name', m.name, 'project_name', p.name) j
        from app.work_items f join app.work_items m on m.id = f.parent_id join app.projects p on p.id = f.project_id
        where f.status = 'done' and (exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = me.id)
          or exists (select 1 from app.assignments a where a.work_item_id = f.parent_id and a.user_id = me.id))
        order by f.completed_at desc nulls last limit 15) x),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'start_date', m.start_date, 'end_date', m.end_date,
        'status', m.status, 'progress_pct', m.progress_pct, 'project_id', p.id, 'project_name', p.name, 'company_name', c.name)
        order by m.end_date nulls first, m.id), '[]')
      from app.assignments a join app.work_items m on m.id = a.work_item_id join app.projects p on p.id = m.project_id
      join app.companies c on c.id = p.company_id
      where a.user_id = me.id and m.level = 'module' and m.status <> 'cancelled'));
end $$;

create or replace function app.r_me_logs(me app.users) returns jsonb
language plpgsql as $$
begin
  return jsonb_build_object('logs', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
      'hours', (select coalesce(sum(hours), 0) from app.log_entries e where e.log_id = l.id),
      'lines', (select count(*) from app.log_entries e where e.log_id = l.id),
      'locked', app.log_locked(l.date)) order by l.date desc), '[]')
    from (select * from app.daily_logs where user_id = me.id order by date desc limit 60) l));
end $$;

create or replace function app.r_notifications(me app.users) returns jsonb
language plpgsql as $$
begin
  return jsonb_build_object('notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id desc), '[]')
    from (select * from app.notifications where user_id = me.id order by id desc limit 60) n));
end $$;

create or replace function app.r_notifications_read(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare ids bigint[];
begin
  if jsonb_typeof(body->'ids') = 'array' then
    ids := array(select (x #>> '{}')::numeric::bigint from jsonb_array_elements(body->'ids') x
                 where jsonb_typeof(x) in ('number','string') and (x #>> '{}') ~ '^\d+$' and (x #>> '{}')::numeric > 0);
  end if;
  if cardinality(ids) > 0 then
    update app.notifications set read_at = now() where user_id = me.id and id = any(ids);
  else
    update app.notifications set read_at = now() where user_id = me.id and read_at is null;
  end if;
  return '{"ok":true}';
end $$;

-- ======================= people =======================
create or replace function app.public_user(u app.users) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role, 'title', u.title, 'active', u.active,
    'has_password', coalesce((select coalesce(au.encrypted_password, '') <> '' from auth.users au where au.id = u.auth_id), false),
    'last_login_at', (select au.last_sign_in_at from auth.users au where au.id = u.auth_id),
    'created_at', u.created_at)
$$;

create or replace function app.validate_password(pw text) returns text
language sql immutable as $$
  select case
    when pw is null or length(pw) < 8 then 'Use at least 8 characters.'
    when pw !~ '[A-Za-z]' or pw !~ '\d' then 'Use letters and at least one number.'
    else null end
$$;

-- Create (or reset) the Supabase Auth account behind a person, with a password.
create or replace function app.set_auth_password(uid bigint, pw text) returns void
language plpgsql security definer set search_path = app, extensions, public as $$
declare u app.users; aid uuid; hash text := extensions.crypt(pw, extensions.gen_salt('bf', 10));
begin
  select * into u from app.users where id = uid;
  if u.auth_id is not null and exists (select 1 from auth.users where id = u.auth_id) then
    update auth.users set encrypted_password = hash, updated_at = now() where id = u.auth_id;
    return;
  end if;
  select id into aid from auth.users where lower(email) = lower(u.email);
  if aid is not null then
    update auth.users set encrypted_password = hash, updated_at = now(), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = aid;
  else
    aid := gen_random_uuid();
    perform set_config('app.creating_user', 'on', true);
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', aid, 'authenticated', 'authenticated', lower(u.email), hash, now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('name', u.name), now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (aid::text, aid, jsonb_build_object('sub', aid::text, 'email', lower(u.email), 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
    perform set_config('app.creating_user', 'off', true);
  end if;
  update app.users set auth_id = aid where id = uid;
end $$;

create or replace function app.r_users(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object('users', (select coalesce(jsonb_agg(app.public_user(u) || jsonb_build_object('open_assignments',
      (select count(*) from app.assignments a join app.work_items w on w.id = a.work_item_id
       where a.user_id = u.id and w.status not in ('done','cancelled'))) order by u.active desc, u.role, u.name), '[]')
    from app.users u));
end $$;

create or replace function app.r_user_create(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare nm text; em text; rl text; ttl text; pw text; prob text; u app.users;
begin
  perform app.require_admin(me);
  nm := app.v_str(body->'name', 120, true, 'Name');
  em := lower(app.v_str(body->'email', 254, true, 'Email'));
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then perform app.fail(400, 'Enter a valid email address.'); end if;
  rl := case when app.jtext(body->'role') = 'admin' then 'admin' else 'workforce' end;
  ttl := app.v_str(body->'title', 120);
  pw := app.jtext(body->'password');
  if coalesce(pw, '') <> '' then
    prob := app.validate_password(pw);
    if prob is not null then perform app.fail(400, 'Temporary password: ' || prob); end if;
  end if;
  if exists (select 1 from app.users where lower(email) = em) then perform app.fail(409, em || ' already has an account.'); end if;
  insert into app.users (name, email, role, title) values (nm, em, rl, ttl) returning * into u;
  if coalesce(pw, '') <> '' then perform app.set_auth_password(u.id, pw); end if;
  perform app.audit(null, 'user', u.id, 'created', nm || ' <' || em || '> as ' || rl, me.id);
  perform app.notify(array[u.id], 'welcome', 'Welcome to the Astute work tracker, ' || split_part(nm, ' ', 1),
    'Your daily targets appear on the Today screen.', '/');
  select * into u from app.users where id = u.id;
  return jsonb_build_object('user', app.public_user(u));
end $$;

create or replace function app.r_user_update(me app.users, uid bigint, body jsonb) returns jsonb
language plpgsql security definer set search_path = app, extensions, public as $$
declare u app.users; is_self boolean; changes text[] := '{}'; em text; rl text; prob text; touched boolean := false;
begin
  perform app.require_admin(me);
  select * into u from app.users where id = uid;
  if u.id is null then perform app.fail(404, 'User not found.'); end if;
  is_self := u.id = me.id;
  if body ? 'name' then
    update app.users set name = app.v_str(body->'name', 120, true, 'Name') where id = uid; changes := changes || 'name'::text; touched := true;
  end if;
  if body ? 'title' then update app.users set title = app.v_str(body->'title', 120) where id = uid; touched := true; end if;
  if body ? 'email' then
    em := lower(app.v_str(body->'email', 254, true, 'Email'));
    if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then perform app.fail(400, 'Enter a valid email address.'); end if;
    if exists (select 1 from app.users where lower(email) = em and id <> uid) then perform app.fail(409, em || ' already has an account.'); end if;
    update app.users set email = em where id = uid;
    if u.auth_id is not null then
      update auth.users set email = em, updated_at = now() where id = u.auth_id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', em) where user_id = u.auth_id and provider = 'email';
    end if;
    changes := changes || 'email'::text; touched := true;
  end if;
  if body ? 'role' then
    rl := case when app.jtext(body->'role') = 'admin' then 'admin' else 'workforce' end;
    if is_self and rl <> 'admin' then perform app.fail(400, 'You cannot remove your own admin role.'); end if;
    update app.users set role = rl where id = uid; changes := changes || ('role → ' || rl); touched := true;
  end if;
  if body ? 'active' then
    if is_self and not app.js_truthy(body->'active') then perform app.fail(400, 'You cannot deactivate your own account.'); end if;
    update app.users set active = app.js_truthy(body->'active') where id = uid;
    changes := changes || case when app.js_truthy(body->'active') then 'reactivated' else 'deactivated' end; touched := true;
  end if;
  if coalesce(app.jtext(body->'password'), '') <> '' and app.jtext(body->'password') <> 'false' then
    prob := app.validate_password(app.jtext(body->'password'));
    if prob is not null then perform app.fail(400, prob); end if;
    perform app.set_auth_password(uid, app.jtext(body->'password'));
    changes := changes || 'password reset'::text; touched := true;
  end if;
  if touched then perform app.audit(null, 'user', uid, 'updated', array_to_string(changes, ', '), me.id); end if;
  select * into u from app.users where id = uid;
  return jsonb_build_object('user', app.public_user(u));
end $$;

create or replace function app.r_me(me app.users) returns jsonb
language sql stable as $$
  select jsonb_build_object('user', app.public_user(me),
    'unread', (select count(*) from app.notifications where user_id = me.id and read_at is null))
$$;
