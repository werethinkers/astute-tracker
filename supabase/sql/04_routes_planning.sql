-- =====================================================================
-- Routes: ventures, projects, modules, features, submissions, import
-- Each function returns exactly the JSON the old Express route returned.
-- =====================================================================

-- Recalculate a project and its flags after any change.
create or replace function app.after(pid bigint) returns void
language plpgsql as $$
begin
  perform app.recalc_project(pid);
  perform app.refresh_flags();
end $$;

create or replace function app.require_admin(me app.users) returns void
language plpgsql as $$
begin
  if me.role <> 'admin' then perform app.fail(403, 'Only admins can do this.'); end if;
end $$;

-- ======================= ventures (companies) =======================
create or replace function app.r_companies(me app.users) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object('companies', coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'project_count', (select count(*) from app.projects p where p.company_id = c.id),
      'holiday_count', (select count(*) from app.holidays hh where hh.company_id = c.id)) order by c.name)
    from app.companies c), '[]'));
end $$;

create or replace function app.company_fields(body jsonb, partial boolean) returns jsonb
language plpgsql as $$
declare
  out_ jsonb := '{}'; offs text[]; clean text[]; k text; v int;
  dflt jsonb := '{"weight_small":1,"weight_medium":2,"weight_large":4}';
begin
  if not partial or body ? 'name' then
    out_ := out_ || jsonb_build_object('name', app.v_str(body->'name', 120, true, 'Venture name'));
  end if;
  if not partial or body ? 'weekly_offs' then
    if jsonb_typeof(body->'weekly_offs') = 'array' then
      offs := array(select jsonb_array_elements_text(body->'weekly_offs'));
    else
      offs := string_to_array(coalesce(app.jtext(body->'weekly_offs'), '0'), ',');
    end if;
    clean := array(select distinct trim(x) from unnest(offs) x where trim(x) ~ '^[0-6]$' order by 1);
    if cardinality(clean) > 3 then perform app.fail(400, 'Choose at most three weekly days off.'); end if;
    out_ := out_ || jsonb_build_object('weekly_offs', array_to_string(clean, ','));
  end if;
  foreach k in array array['weight_small','weight_medium','weight_large'] loop
    if not partial or body ? k then
      v := app.v_int(case when body->k is null or jsonb_typeof(body->k) = 'null' then dflt->k else body->k end, 'Weight', 1, 20);
      out_ := out_ || jsonb_build_object(k, coalesce(v, (dflt->>k)::int));
    end if;
  end loop;
  if out_ ? 'weight_small' and out_ ? 'weight_medium' and out_ ? 'weight_large'
     and not ((out_->>'weight_small')::int <= (out_->>'weight_medium')::int and (out_->>'weight_medium')::int <= (out_->>'weight_large')::int) then
    perform app.fail(400, 'Weights must rise from small to large.');
  end if;
  return out_;
end $$;

create or replace function app.r_company_create(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare f jsonb; c app.companies;
begin
  perform app.require_admin(me);
  f := app.company_fields(body, false);
  insert into app.companies (name, weekly_offs, weight_small, weight_medium, weight_large)
  values (f->>'name', f->>'weekly_offs', (f->>'weight_small')::int, (f->>'weight_medium')::int, (f->>'weight_large')::int)
  returning * into c;
  perform app.audit(null, 'company', c.id, 'created', c.name, me.id);
  return jsonb_build_object('company', to_jsonb(c));
end $$;

create or replace function app.r_company_update(me app.users, cid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare c app.companies; f jsonb; pid bigint;
begin
  perform app.require_admin(me);
  select * into c from app.companies where id = cid;
  if c.id is null then perform app.fail(404, 'Venture not found.'); end if;
  f := app.company_fields(body, true);
  if not (coalesce((f->>'weight_small')::int, c.weight_small) <= coalesce((f->>'weight_medium')::int, c.weight_medium)
      and coalesce((f->>'weight_medium')::int, c.weight_medium) <= coalesce((f->>'weight_large')::int, c.weight_large)) then
    perform app.fail(400, 'Weights must rise from small to large.');
  end if;
  update app.companies set
    name = case when f ? 'name' then f->>'name' else name end,
    weekly_offs = case when f ? 'weekly_offs' then f->>'weekly_offs' else weekly_offs end,
    weight_small = coalesce((f->>'weight_small')::int, weight_small),
    weight_medium = coalesce((f->>'weight_medium')::int, weight_medium),
    weight_large = coalesce((f->>'weight_large')::int, weight_large)
  where id = cid;
  if f ? 'weekly_offs' then
    for pid in select id from app.projects where company_id = cid order by id loop perform app.recalc_project(pid); end loop;
  end if;
  perform app.refresh_flags();
  select * into c from app.companies where id = cid;
  return jsonb_build_object('company', to_jsonb(c));
end $$;

create or replace function app.r_holidays(me app.users, cid bigint) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object('holidays', coalesce((select jsonb_agg(to_jsonb(h) order by h.date) from app.holidays h where h.company_id = cid), '[]'));
end $$;

create or replace function app.r_holiday_add(me app.users, cid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare d date; nm text; pid bigint;
begin
  perform app.require_admin(me);
  if not exists (select 1 from app.companies where id = cid) then perform app.fail(404, 'Venture not found.'); end if;
  d := app.v_date(body->'date', 'Date', true);
  nm := app.v_str(body->'name', 120, true, 'Holiday name');
  insert into app.holidays (company_id, date, name) values (cid, d, nm)
  on conflict (company_id, date) do update set name = excluded.name;
  for pid in select id from app.projects where company_id = cid order by id loop perform app.recalc_project(pid); end loop;
  perform app.refresh_flags();
  return '{"ok":true}';
end $$;

create or replace function app.r_holiday_delete(me app.users, hid bigint) returns jsonb
language plpgsql as $$
declare h app.holidays; pid bigint;
begin
  perform app.require_admin(me);
  select * into h from app.holidays where id = hid;
  if h.id is null then perform app.fail(404, 'Holiday not found.'); end if;
  delete from app.holidays where id = hid;
  for pid in select id from app.projects where company_id = h.company_id order by id loop perform app.recalc_project(pid); end loop;
  perform app.refresh_flags();
  return '{"ok":true}';
end $$;

-- ======================= projects =======================
create or replace function app.project_summary(pid bigint, me app.users) returns jsonb
language plpgsql as $$
declare
  p app.projects; cname text; modules int; features int; done int; submitted int; proposed int;
  base jsonb; fl_n int; fl_red int; people int; mine int; admin boolean := me.role = 'admin';
begin
  select * into p from app.projects where id = pid;
  select name into cname from app.companies where id = p.company_id;
  select count(*) filter (where level = 'module' and status <> 'cancelled'),
         count(*) filter (where level = 'feature' and status not in ('proposed','cancelled')),
         count(*) filter (where level = 'feature' and status = 'done'),
         count(*) filter (where level = 'feature' and status = 'submitted'),
         count(*) filter (where level = 'feature' and status = 'proposed')
    into modules, features, done, submitted, proposed
  from app.work_items where project_id = pid;
  base := jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status, 'company_id', p.company_id, 'company_name', cname,
    'target_end_date', p.target_end_date, 'show_progress_to_workforce', p.show_progress_to_workforce, 'auto_approve', p.auto_approve,
    'modules', modules, 'features', features, 'features_done', done,
    'can_add_module', admin or p.status = 'active');
  if admin then
    select count(*), count(*) filter (where severity = 'red') into fl_n, fl_red from app.flags where cleared_at is null and project_id = pid;
    select count(distinct a.user_id) into people from app.assignments a join app.work_items w on w.id = a.work_item_id where w.project_id = pid;
    return base || jsonb_build_object('progress_pct', p.progress_pct, 'pending_pct', p.pending_pct)
      || app.schedule_facts('project', pid)
      || jsonb_build_object('features_submitted', submitted, 'features_proposed', proposed,
                            'open_flags', fl_n, 'red_flags', case when fl_n = 0 then 0 else fl_red end, 'people', people);
  end if;
  select count(*) into mine from app.work_items f
  where f.project_id = pid and f.level = 'feature' and f.status not in ('done','cancelled')
    and (exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = me.id)
      or exists (select 1 from app.assignments a where a.work_item_id = f.parent_id and a.user_id = me.id));
  return base || jsonb_build_object(
    'progress_pct', case when p.show_progress_to_workforce then to_jsonb(p.progress_pct) else 'null'::jsonb end,
    'my_open_features', mine,
    'on_project', exists (select 1 from app.assignments a join app.work_items w on w.id = a.work_item_id
                          where a.user_id = me.id and w.project_id = pid),
    'end_date', (select max(end_date) from app.work_items where project_id = pid and level = 'module' and status <> 'cancelled'));
end $$;

create or replace function app.r_projects(me app.users) returns jsonb
language plpgsql as $$
declare ids bigint[] := app.visible_project_ids(me.id, me.role = 'admin');
begin
  return jsonb_build_object('projects', coalesce((
    select jsonb_agg(app.project_summary(p.id, me) order by c.name, p.name)
    from app.projects p join app.companies c on c.id = p.company_id where p.id = any(ids)), '[]'),
    'ventures', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from app.companies c), '[]'));
end $$;

create or replace function app.project_fields(body jsonb, partial boolean) returns jsonb
language plpgsql as $$
declare f jsonb := '{}'; cid int;
begin
  if not partial or body ? 'name' then f := f || jsonb_build_object('name', app.v_str(body->'name', 160, true, 'Project name')); end if;
  if body ? 'description' then f := f || jsonb_build_object('description', app.v_str(body->'description', 4000)); end if;
  if not partial or body ? 'company_id' then
    cid := app.v_int(body->'company_id', 'Venture', null, null, true);
    if not exists (select 1 from app.companies where id = cid) then perform app.fail(400, 'Choose a venture.'); end if;
    f := f || jsonb_build_object('company_id', cid);
  end if;
  if body ? 'target_end_date' then f := f || jsonb_build_object('target_end_date', app.v_date(body->'target_end_date', 'Target end date')); end if;
  if body ? 'status' then
    if app.jtext(body->'status') is null or app.jtext(body->'status') not in ('active','on_hold','completed','cancelled') then
      perform app.fail(400, 'Unknown project status.');
    end if;
    f := f || jsonb_build_object('status', body->>'status');
  end if;
  if body ? 'show_progress_to_workforce' then f := f || jsonb_build_object('show_progress_to_workforce', app.v_bool(body->'show_progress_to_workforce')); end if;
  if body ? 'auto_approve' then f := f || jsonb_build_object('auto_approve', app.v_bool(body->'auto_approve')); end if;
  return f;
end $$;

create or replace function app.r_project_create(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare f jsonb; pid bigint;
begin
  perform app.require_admin(me);
  f := app.project_fields(body, false);
  insert into app.projects (company_id, name, description, target_end_date, show_progress_to_workforce, auto_approve, created_by)
  values ((f->>'company_id')::bigint, f->>'name', f->>'description', (f->>'target_end_date')::date,
          coalesce((f->>'show_progress_to_workforce')::boolean, true), coalesce((f->>'auto_approve')::boolean, false), me.id)
  returning id into pid;
  perform app.audit(pid, 'project', pid, 'created', f->>'name', me.id);
  return jsonb_build_object('project', jsonb_build_object('id', pid));
end $$;

create or replace function app.r_project_update(me app.users, pid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare f jsonb; keys text[];
begin
  perform app.require_admin(me);
  if not exists (select 1 from app.projects where id = pid) then perform app.fail(404, 'Project not found.'); end if;
  f := app.project_fields(body, true);
  keys := array(select k from unnest(array['name','description','company_id','target_end_date','status','show_progress_to_workforce','auto_approve']) k where f ? k);
  if cardinality(keys) > 0 then
    update app.projects set
      name = case when f ? 'name' then f->>'name' else name end,
      description = case when f ? 'description' then f->>'description' else description end,
      company_id = case when f ? 'company_id' then (f->>'company_id')::bigint else company_id end,
      target_end_date = case when f ? 'target_end_date' then (f->>'target_end_date')::date else target_end_date end,
      status = case when f ? 'status' then f->>'status' else status end,
      show_progress_to_workforce = case when f ? 'show_progress_to_workforce' then (f->>'show_progress_to_workforce')::boolean else show_progress_to_workforce end,
      auto_approve = case when f ? 'auto_approve' then (f->>'auto_approve')::boolean else auto_approve end
    where id = pid;
    perform app.audit(pid, 'project', pid, 'updated', array_to_string(keys, ', '), me.id);
  end if;
  perform app.after(pid);
  return '{"ok":true}';
end $$;

-- Full project tree, filtered by what the viewer may see.
create or replace function app.r_project(me app.users, pid bigint) returns jsonb
language plpgsql as $$
declare
  admin boolean := me.role = 'admin'; m app.work_items; on_module boolean; manage boolean; feats jsonb; base jsonb; modules jsonb := '[]';
  out_ jsonb; show_pct boolean;
begin
  if not exists (select 1 from app.projects where id = pid) then perform app.fail(404, 'Project not found.'); end if;
  if not admin and not (pid = any(app.visible_project_ids(me.id, false))) then perform app.fail(404, 'Project not found.'); end if;
  select admin or show_progress_to_workforce into show_pct from app.projects where id = pid;

  for m in select * from app.work_items where project_id = pid and level = 'module' order by sequence, start_date nulls first, id loop
    on_module := admin or app.is_assigned(me.id, m.id);
    manage := app.can_manage(me.id, admin, m.id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'description', f.description, 'size', f.size, 'weight', f.weight, 'status', f.status,
        'origin', f.origin, 'requires_proof', f.requires_proof, 'sent_back', f.sent_back,
        'planned_start', f.planned_start, 'planned_end', f.planned_end, 'manual_dates', f.manual_dates, 'sequence', f.sequence,
        'status_reason', f.status_reason, 'proposal_reason', f.proposal_reason, 'work_pct', f.work_pct,
        'assignees', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'is_lead', a.is_lead, 'active', u.active) order by a.is_lead desc, a.user_id), '[]')
                      from app.assignments a join app.users u on u.id = a.user_id where a.work_item_id = f.id),
        'effective', (select coalesce(jsonb_agg(u.name order by u.id), '[]') from app.users u where u.id = any(app.effective_assignees(f.id))),
        'last_log', (select max(l.date) from app.log_entries e join app.daily_logs l on l.id = e.log_id where e.work_item_id = f.id),
        'can_open', on_module or manage or app.is_assigned(me.id, f.id),
        'mine', me.id = any(app.effective_assignees(f.id)),
        'self_joined', exists (select 1 from app.assignments a where a.work_item_id = f.id and a.user_id = me.id and a.assigned_by = me.id))
        || case when admin then jsonb_build_object(
             'flags', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.flag_type, 'severity', x.severity, 'title', x.title) order by x.id), '[]')
                       from app.flags x where x.cleared_at is null and x.project_id = pid and x.entity_type = 'feature' and x.entity_id = f.id),
             'late', app.schedule_facts('feature', f.id)->>'health' = 'red')
           else '{}'::jsonb end
        order by f.sequence, f.planned_start nulls first, f.id), '[]')
      into feats
    from app.work_items f
    where f.project_id = pid and f.level = 'feature' and f.parent_id = m.id;
    base := jsonb_build_object(
      'id', m.id, 'name', m.name, 'description', m.description, 'size', m.size, 'weight', m.weight, 'status', m.status,
      'status_reason', m.status_reason, 'start_date', m.start_date, 'duration_days', m.duration_days, 'end_date', m.end_date,
      'original_end_date', m.original_end_date,
      'assignees', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'is_lead', a.is_lead, 'active', u.active) order by a.is_lead desc, a.user_id), '[]')
                    from app.assignments a join app.users u on u.id = a.user_id where a.work_item_id = m.id),
      'features', feats, 'limited', false, 'origin', m.origin, 'on_team', app.is_assigned(me.id, m.id), 'can_manage', manage,
      'self_joined', exists (select 1 from app.assignments a where a.work_item_id = m.id and a.user_id = me.id and a.assigned_by = me.id),
      'added_by', case when m.origin = 'workforce' then (select name from app.users where id = m.created_by) end);
    if admin then
      base := base || jsonb_build_object('progress_pct', m.progress_pct, 'pending_pct', m.pending_pct)
        || app.schedule_facts('module', m.id)
        || jsonb_build_object('flags', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.flag_type, 'severity', x.severity, 'title', x.title) order by x.id), '[]')
                                        from app.flags x where x.cleared_at is null and x.project_id = pid and x.entity_type = 'module' and x.entity_id = m.id));
    elsif on_module or show_pct then
      base := base || jsonb_build_object('progress_pct', m.progress_pct, 'pending_pct', m.pending_pct);
    end if;
    modules := modules || jsonb_build_array(base);
  end loop;

  out_ := jsonb_build_object('project', app.project_summary(pid, me), 'modules', modules);
  if admin then
    out_ := out_ || jsonb_build_object(
      'flags', (select coalesce(jsonb_agg(to_jsonb(f) order by f.severity desc, f.raised_at, f.id), '[]') from app.flags f where f.cleared_at is null and f.project_id = pid),
      'snapshots', (select coalesce(jsonb_agg(jsonb_build_object('date', s.date, 'progress_pct', s.progress_pct, 'time_pct', s.time_pct) order by s.date), '[]')
                    from app.progress_snapshots s where s.entity_type = 'project' and s.entity_id = pid));
  end if;
  return out_;
end $$;

create or replace function app.r_project_activity(me app.users, pid bigint) returns jsonb
language plpgsql as $$
begin
  perform app.require_admin(me);
  return jsonb_build_object('activity', coalesce((
    select jsonb_agg(x.j order by x.id desc) from (
      select a.id, to_jsonb(a) || jsonb_build_object('actor', u.name) j
      from app.audit_log a left join app.users u on u.id = a.actor_id where a.project_id = pid
      order by a.id desc limit 150) x), '[]'));
end $$;

-- ======================= modules & features =======================
create or replace function app.insert_feature(p_project bigint, p_module bigint, p_company bigint, f jsonb,
  p_origin text default 'admin', p_status text default 'not_started', p_actor bigint default null, p_reason text default null)
returns bigint language plpgsql as $$
declare nm text; sz text; seq int; fid bigint;
begin
  nm := app.v_str(f->'name', 200, true, 'Feature name');
  sz := app.v_size(coalesce(nullif(app.jtext(f->'size'), ''), 'medium'), 'Feature size');
  select coalesce(max(sequence), 0) + 1 into seq from app.work_items where parent_id = p_module;
  insert into app.work_items (project_id, parent_id, level, name, description, size, weight, sequence, status, origin,
                              proposed_by, proposal_reason, accepted_by, requires_proof, created_by)
  values (p_project, p_module, 'feature', nm, app.v_str(f->'description', 4000), sz, app.weight_for(p_company, sz), seq, p_status, p_origin,
          case when p_origin = 'workforce' then p_actor end, p_reason, case when p_origin = 'admin' then p_actor end,
          app.v_bool(f->'requires_proof'), p_actor)
  returning id into fid;
  return fid;
end $$;

-- Replace an item's assignees. Returns {added, removed}.
create or replace function app.set_assignees(item bigint, ids jsonb, lead jsonb, actor bigint) returns jsonb
language plpgsql as $$
declare clean bigint[] := '{}'; v jsonb; n numeric; uid bigint; u app.users; v_before bigint[]; lead_id numeric;
begin
  for v in select * from jsonb_array_elements(case when jsonb_typeof(ids) = 'array' then ids else '[]'::jsonb end) loop
    begin n := (v #>> '{}')::numeric; exception when others then n := null; end;
    continue when n is null or n = 0;
    uid := n::bigint;
    if not (uid = any(clean)) then clean := clean || uid; end if;
  end loop;
  foreach uid in array clean loop
    select * into u from app.users where id = uid;
    if u.id is null then perform app.fail(400, 'One of the chosen people no longer exists.'); end if;
    if not u.active then perform app.fail(400, 'One of the chosen people is deactivated.'); end if;
  end loop;
  v_before := app.assignee_ids(item);
  delete from app.assignments where work_item_id = item;
  begin lead_id := (lead #>> '{}')::numeric; exception when others then lead_id := null; end;
  foreach uid in array clean loop
    insert into app.assignments (work_item_id, user_id, is_lead, assigned_by)
    values (item, uid, (lead_id is not null and lead_id = uid) or cardinality(clean) = 1, actor);
  end loop;
  return jsonb_build_object(
    'added', to_jsonb(array(select x from unnest(clean) x where not (x = any(v_before)))),
    'removed', to_jsonb(array(select x from unnest(v_before) x where not (x = any(clean)))));
end $$;

-- Names already used in a project (modules) or a module (features), ignoring case and spacing. Cancelled work does not count.
create or replace function app.name_taken(p_project bigint, p_module bigint, nm text) returns text
language sql stable as $$
  select w.name from app.work_items w
  where w.project_id = p_project and w.status <> 'cancelled'
    and case when p_module is null then w.level = 'module' else w.level = 'feature' and w.parent_id = p_module end
    and lower(regexp_replace(trim(w.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(nm), '\s+', ' ', 'g'))
  limit 1
$$;

create or replace function app.check_feature_names(p_project bigint, p_module bigint, names text[]) returns void
language plpgsql as $$
declare nm text; seen text[] := '{}'; k text; taken text;
begin
  foreach nm in array names loop
    k := lower(regexp_replace(trim(nm), '\s+', ' ', 'g'));
    if k = any(seen) then perform app.fail(400, 'The feature "' || trim(nm) || '" is listed twice.'); end if;
    seen := seen || k;
    if p_module is not null then
      taken := app.name_taken(p_project, p_module, nm);
      if taken is not null then
        perform app.fail(409, 'This module already has a feature called "' || taken || '". Join it instead of adding it again.');
      end if;
    end if;
  end loop;
end $$;

-- A module's length: working days, or a deadline the working days are counted up to.
create or replace function app.module_days(body jsonb, st date, cid bigint, required boolean default true) returns int
language plpgsql as $$
begin
  if app.jtext(body->'end_date') is not null and app.jtext(body->'duration_days') is null then
    return app.days_to_deadline(st, app.v_date(body->'end_date', 'Deadline', true), cid);
  end if;
  return app.v_int(body->'duration_days', 'Duration', 1, 730, required);
end $$;

-- Admins add modules to any project. Anyone on the team can add one to an active project:
-- they are always on it (and lead it unless they pick someone else), and they can plan it afterwards.
create or replace function app.r_module_create(me app.users, pid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare p app.projects; admin boolean := me.role = 'admin'; nm text; sz text; st date; days int; feats jsonb; f jsonb;
  mid bigint; seq int; res jsonb; ids jsonb; lead jsonb; v_end date;
begin
  select * into p from app.projects where id = pid;
  if p.id is null or not (pid = any(app.visible_project_ids(me.id, admin))) then perform app.fail(404, 'Project not found.'); end if;
  if not admin and p.status <> 'active' then perform app.fail(400, 'Modules can only be added to active projects.'); end if;
  nm := app.v_str(body->'name', 200, true, 'Module name');
  sz := app.v_size(app.jtext(body->'size'), 'Module size');
  st := app.v_date(body->'start_date', 'Start date', true);
  days := app.module_days(body, st, p.company_id);
  select coalesce(jsonb_agg(x), '[]') into feats
  from jsonb_array_elements(case when jsonb_typeof(body->'features') = 'array' then body->'features' else '[]'::jsonb end) x
  where jsonb_typeof(x) = 'object' and app.trim_ws(app.jtext(x->'name')) <> '';
  if jsonb_array_length(feats) = 0 then
    perform app.fail(400, 'List the features this module contains. Every module needs at least one.');
  end if;
  if app.name_taken(pid, null, nm) is not null then
    perform app.fail(409, 'This project already has a module called "' || app.name_taken(pid, null, nm) || '". Open it and press Join instead of adding it again.');
  end if;
  perform app.check_feature_names(pid, null, array(select x->>'name' from jsonb_array_elements(feats) x));
  select coalesce(max(sequence), 0) + 1 into seq from app.work_items where project_id = pid and level = 'module';
  insert into app.work_items (project_id, level, name, description, size, weight, sequence, start_date, duration_days, origin, created_by)
  values (pid, 'module', nm, app.v_str(body->'description', 4000), sz, app.weight_for(p.company_id, sz), seq, st, days,
          case when admin then 'admin' else 'workforce' end, me.id)
  returning id into mid;
  -- Features listed with the module are its planned scope, whoever plans it.
  for f in select * from jsonb_array_elements(feats) loop
    perform app.insert_feature(pid, mid, p.company_id, f, 'admin', 'not_started', me.id);
  end loop;
  ids := case when jsonb_typeof(body->'assignee_ids') = 'array' then body->'assignee_ids' else '[]'::jsonb end;
  lead := body->'lead_id';
  if not admin then
    ids := ids || to_jsonb(me.id);
    if lead is null or jsonb_typeof(lead) = 'null' then lead := to_jsonb(me.id); end if;
  end if;
  if jsonb_array_length(ids) > 0 then
    res := app.set_assignees(mid, ids, lead, me.id);
    perform app.notify(array(select x::bigint from jsonb_array_elements_text(res->'added') x where x::bigint <> me.id), 'assigned',
      'You were assigned to module ' || nm, p.name || case when admin then '' else ', added by ' || me.name end, '/projects/' || pid);
  end if;
  perform app.audit(pid, 'module', mid, 'created',
    nm || ' (' || sz || ', ' || days || ' working days from ' || st || ', ' || jsonb_array_length(feats) || ' features)'
    || case when admin then '' else ', added by the team' end, me.id);
  perform app.after(pid);
  if not admin then
    v_end := app.add_wd(st, days, p.company_id);
    perform app.notify(app.admin_ids(), 'module_added', me.name || ' added module ' || nm,
      p.name || ': ' || jsonb_array_length(feats) || ' feature' || case when jsonb_array_length(feats) = 1 then '' else 's' end
      || ', due ' || app.fd(v_end) || '. People: ' || app.user_names(app.assignee_ids(mid)) || '.', '/projects/' || pid);
  end if;
  return jsonb_build_object('module', jsonb_build_object('id', mid));
end $$;

create or replace function app.r_feature_create(me app.users, mid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare m app.work_items; fid bigint; why text; res jsonb;
begin
  select * into m from app.work_items where id = mid;
  if m.id is null or m.level <> 'module' then perform app.fail(404, 'Module not found.'); end if;
  if not app.can_manage(me.id, me.role = 'admin', mid) then
    perform app.fail(403, 'Only admins and the person who added this module can add features to it directly. Use Add a feature to suggest one.');
  end if;
  if me.role <> 'admin' and m.status in ('done','cancelled') then perform app.fail(400, 'This module is closed.'); end if;
  perform app.check_feature_names(m.project_id, m.id, array[coalesce(app.jtext(body->'name'), '')]);
  fid := app.insert_feature(m.project_id, m.id, app.company_of_project(m.project_id), body, 'admin', 'not_started', me.id);
  if jsonb_typeof(body->'assignee_ids') = 'array' and jsonb_array_length(body->'assignee_ids') > 0 then
    why := app.module_not_ready(m.id);
    if why is not null and m.start_date is null then perform app.fail(400, why); end if;
    res := app.set_assignees(fid, body->'assignee_ids', body->'lead_id', me.id);
    perform app.notify(array(select x::bigint from jsonb_array_elements_text(res->'added') x where x::bigint <> me.id), 'assigned',
      'You were assigned to feature ' || coalesce(app.jtext(body->'name'), ''), 'Module ' || m.name, '/items/' || fid);
  end if;
  perform app.audit(m.project_id, 'feature', fid, 'created', coalesce(app.jtext(body->'name'), '') || ' in ' || m.name, me.id);
  perform app.after(m.project_id);
  return jsonb_build_object('feature', jsonb_build_object('id', fid));
end $$;

-- Anyone on the team proposes an extra feature for any open module; it is theirs to work on, and counts once an admin accepts it.
create or replace function app.r_feature_propose(me app.users, mid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare m app.work_items; reason text; fid bigint;
begin
  select * into m from app.work_items where id = mid;
  if m.id is null or m.level <> 'module' or not (m.project_id = any(app.visible_project_ids(me.id, me.role = 'admin'))) then
    perform app.fail(404, 'Module not found.');
  end if;
  if m.status in ('done','cancelled','on_hold') then perform app.fail(400, 'This module is closed.'); end if;
  if me.role <> 'admin' and (select status from app.projects where id = m.project_id) <> 'active' then
    perform app.fail(400, 'This project is not active.');
  end if;
  reason := app.v_str(body->'reason', 2000, true, 'Why it is needed');
  perform app.check_feature_names(m.project_id, m.id, array[coalesce(app.jtext(body->'name'), '')]);
  fid := app.insert_feature(m.project_id, m.id, app.company_of_project(m.project_id), body, 'workforce', 'proposed', me.id, reason);
  insert into app.assignments (work_item_id, user_id, is_lead, assigned_by) values (fid, me.id, true, me.id);
  perform app.audit(m.project_id, 'feature', fid, 'proposed', coalesce(app.jtext(body->'name'), '') || ' in ' || m.name || ': ' || reason, me.id);
  perform app.notify(app.admin_ids(), 'proposed', me.name || ' proposed a feature: ' || coalesce(app.jtext(body->'name'), ''), 'Module ' || m.name, '/reviews');
  perform app.after(m.project_id);
  return jsonb_build_object('feature', jsonb_build_object('id', fid));
end $$;

create or replace function app.r_feature_accept(me app.users, fid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare f app.work_items; sz text;
begin
  perform app.require_admin(me);
  select * into f from app.work_items where id = fid;
  if f.id is null or f.status <> 'proposed' then perform app.fail(400, 'Only proposed features can be accepted.'); end if;
  sz := app.v_size(coalesce(nullif(app.jtext(body->'size'), ''), f.size));
  update app.work_items set status = 'not_started', size = sz, weight = app.weight_for(app.company_of_project(f.project_id), sz),
    accepted_by = me.id, status_reason = null where id = fid;
  perform app.audit(f.project_id, 'feature', fid, 'accepted', f.name || ' as ' || sz, me.id);
  perform app.notify(app.assignee_ids(fid) || f.proposed_by, 'accepted', 'Your feature "' || f.name || '" was accepted', 'Size: ' || sz, '/items/' || fid);
  perform app.after(f.project_id);
  return '{"ok":true}';
end $$;

create or replace function app.r_feature_decline(me app.users, fid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare f app.work_items; reason text;
begin
  perform app.require_admin(me);
  select * into f from app.work_items where id = fid;
  if f.id is null or f.status <> 'proposed' then perform app.fail(400, 'Only proposed features can be declined.'); end if;
  reason := app.v_str(body->'reason', 2000, true, 'Reason');
  update app.work_items set status = 'cancelled', status_reason = reason where id = fid;
  perform app.audit(f.project_id, 'feature', fid, 'declined', f.name || ': ' || reason, me.id);
  perform app.notify(array[f.proposed_by], 'declined', 'Your feature "' || f.name || '" was declined', reason, '/items/' || fid);
  perform app.after(f.project_id);
  return '{"ok":true}';
end $$;

create or replace function app.r_item_update(me app.users, iid bigint, b jsonb) returns jsonb
language plpgsql as $$
declare it app.work_items; m app.work_items; notes text[] := '{}'; keys text[] := '{}'; v_size text; ps date; pe date;
  new_start date; new_days int; seq int;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null then perform app.fail(404, 'Item not found.'); end if;
  if not app.can_manage(me.id, me.role = 'admin', iid) then perform app.fail(403, 'Only admins and the person who added this module can change it.'); end if;
  if me.role <> 'admin' and it.status = 'proposed' then perform app.fail(400, 'An admin decides on proposed features.'); end if;
  if me.role <> 'admin' and (b ?| array['start_date','duration_days','end_date','planned_start','planned_end','manual_dates']) then
    perform app.fail(403, 'Deadlines are set. Only an admin can change dates now.');
  end if;
  if b ? 'name' then
    if lower(trim(app.v_str(b->'name', 200, true, 'Name'))) <> lower(trim(it.name))
       and app.name_taken(it.project_id, case when it.level = 'feature' then it.parent_id end, app.jtext(b->'name')) is not null then
      perform app.fail(409, 'That name is already used here.');
    end if;
    update app.work_items set name = app.v_str(b->'name', 200, true, 'Name') where id = iid; keys := keys || 'name'::text;
  end if;
  if b ? 'description' then
    update app.work_items set description = app.v_str(b->'description', 4000) where id = iid; keys := keys || 'description'::text;
  end if;
  if b ? 'size' and app.jtext(b->'size') is distinct from it.size then
    v_size := app.v_size(app.jtext(b->'size'));
    update app.work_items set size = v_size, weight = app.weight_for(app.company_of_project(it.project_id), v_size) where id = iid;
    notes := notes || ('size ' || it.size || ' → ' || v_size); keys := keys || 'size'::text || 'weight'::text;
  end if;
  if b ? 'sequence' then
    seq := app.v_int(b->'sequence', 'Order', 0, 10000);
    if seq is not null then update app.work_items set sequence = seq where id = iid; keys := keys || 'sequence'::text; end if;
  end if;
  if b ? 'requires_proof' then
    update app.work_items set requires_proof = app.v_bool(b->'requires_proof') where id = iid; keys := keys || 'requires_proof'::text;
  end if;
  if it.level = 'module' then
    if b ? 'start_date' then new_start := app.v_date(b->'start_date', 'Start date', true); end if;
    if b ? 'duration_days' or b ? 'end_date' then
      new_days := app.module_days(b, coalesce(new_start, it.start_date), app.company_of_project(it.project_id));
    end if;
    if new_start is not null then update app.work_items set start_date = new_start where id = iid; keys := keys || 'start_date'::text; end if;
    if new_days is not null then update app.work_items set duration_days = new_days where id = iid; keys := keys || 'duration_days'::text; end if;
    if (new_start is not null and new_start is distinct from it.start_date) or (new_days is not null and new_days is distinct from it.duration_days) then
      notes := notes || ('schedule ' || coalesce(it.start_date::text, 'null') || ' for ' || coalesce(it.duration_days::text, 'null') || 'd → '
        || coalesce(new_start, it.start_date)::text || ' for ' || coalesce(new_days, it.duration_days) || 'd'
        || case when app.trim_ws(app.jtext(b->'reason')) <> '' then ' (' || left(app.jtext(b->'reason'), 300) || ')' else '' end);
    end if;
  else
    if b->'manual_dates' in ('false'::jsonb, '0'::jsonb) then
      update app.work_items set manual_dates = false where id = iid; keys := keys || 'manual_dates'::text;
    end if;
    if b ? 'planned_start' or b ? 'planned_end' then
      ps := app.v_date(b->'planned_start', 'Planned start', true);
      pe := app.v_date(b->'planned_end', 'Planned end', true);
      if pe < ps then perform app.fail(400, 'The end date must be on or after the start date.'); end if;
      select * into m from app.work_items where id = it.parent_id;
      if m.start_date is not null and (ps < m.start_date or (m.end_date is not null and pe > m.end_date)) then
        perform app.fail(400, 'Feature dates must sit inside the module window (' || m.start_date || ' to ' || coalesce(m.end_date::text, 'null') || ').');
      end if;
      update app.work_items set planned_start = ps, planned_end = pe, manual_dates = true where id = iid;
      keys := keys || 'planned_start'::text || 'planned_end'::text || 'manual_dates'::text;
      notes := notes || ('dates set to ' || ps || ' – ' || pe);
    end if;
  end if;
  if cardinality(keys) > 0 then
    perform app.audit(it.project_id, it.level, iid, 'edited',
      coalesce(nullif(array_to_string(notes, '; '), ''), array_to_string(keys, ', ')), me.id);
  end if;
  perform app.after(it.project_id);
  return '{"ok":true}';
end $$;

-- Status changes. Workforce: start, block, unblock. Admin: also hold, resume, cancel, reopen.
create or replace function app.r_item_status(me app.users, iid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare
  it app.work_items; v_to text := coalesce(app.jtext(body->'status'), ''); reason text; admin boolean := me.role = 'admin';
  v_from text; st text; new_status text; now_ timestamptz := app.app_now();
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or not app.can_see(me.id, admin, iid) then perform app.fail(404, 'Item not found.'); end if;
  reason := app.v_str(body->'reason', 2000);
  v_from := it.status;

  if it.level = 'module' then
    if not admin then perform app.fail(400, 'Only admins can change a module status.'); end if;
    if v_to not in ('on_hold','cancelled','resume') then perform app.fail(400, 'Modules can only be put on hold, resumed or cancelled.'); end if;
    if v_to <> 'resume' and reason is null then perform app.fail(400, 'Give a reason.'); end if;
    if v_to = 'resume' and v_from not in ('on_hold','cancelled') then perform app.fail(400, 'This module is not paused.'); end if;
    st := case when v_to = 'resume' then 'not_started' else v_to end;
    update app.work_items set status = st, status_reason = case when v_to = 'resume' then null else reason end where id = iid;
    perform app.audit(it.project_id, 'module', iid, v_to, reason, me.id);
    perform app.after(it.project_id);
    return '{"ok":true}';
  end if;

  if not app.can_work(me.id, admin, iid) then perform app.fail(400, 'You are not assigned to this feature.'); end if;
  case v_to
    when 'in_progress' then
      if not (v_from in ('not_started','blocked','proposed') or (admin and v_from in ('done','on_hold'))) then
        perform app.fail(400, 'This feature cannot be started from its current status.');
      end if;
      if v_from = 'proposed' then perform app.fail(400, 'Wait for an admin to accept this feature before starting it.'); end if;
      if v_from = 'done' and reason is null then perform app.fail(400, 'Give a reason for reopening.'); end if;
      new_status := 'in_progress';
      update app.work_items set status = 'in_progress', status_reason = case when v_from = 'done' then reason end,
        started_at = coalesce(started_at, now_), blocked_at = null, completed_at = null where id = iid;
    when 'blocked' then
      if v_from not in ('not_started','in_progress') then perform app.fail(400, 'Only open work can be marked blocked.'); end if;
      if reason is null then perform app.fail(400, 'Say what this is waiting on.'); end if;
      new_status := 'blocked';
      update app.work_items set status = 'blocked', status_reason = reason, blocked_at = now_, started_at = coalesce(started_at, now_) where id = iid;
    when 'on_hold' then
      if not admin then perform app.fail(400, 'Only admins can put work on hold.'); end if;
      if v_from in ('done','cancelled') then perform app.fail(400, 'This feature is closed.'); end if;
      if reason is null then perform app.fail(400, 'Give a reason.'); end if;
      new_status := 'on_hold';
      update app.work_items set status = 'on_hold', status_reason = reason where id = iid;
    when 'resume' then
      if not (admin and v_from in ('on_hold','cancelled')) then perform app.fail(400, 'Only paused or cancelled work can be resumed by an admin.'); end if;
      new_status := case when it.started_at is not null then 'in_progress' else 'not_started' end;
      update app.work_items set status = new_status, status_reason = null where id = iid;
    when 'cancelled' then
      if not admin then perform app.fail(400, 'Only admins can cancel work.'); end if;
      if reason is null then perform app.fail(400, 'Give a reason.'); end if;
      new_status := 'cancelled';
      update app.work_items set status = 'cancelled', status_reason = reason where id = iid;
    else
      perform app.fail(400, 'Unknown status change.');
  end case;
  perform app.audit(it.project_id, 'feature', iid, v_from || ' → ' || new_status, reason, me.id);
  if (admin and v_to in ('on_hold','cancelled','resume')) or (v_to = 'in_progress' and v_from = 'done') then
    perform app.notify(app.effective_assignees(iid), 'status', it.name || ' is now ' || regexp_replace(new_status, '_', ' '), reason, '/items/' || iid);
  end if;
  perform app.after(it.project_id);
  return '{"ok":true}';
end $$;

create or replace function app.r_item_assignees(me app.users, iid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare it app.work_items; mid bigint; why text; res jsonb; pname text; ids jsonb;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null then perform app.fail(404, 'Item not found.'); end if;
  if not app.can_manage(me.id, me.role = 'admin', iid) then perform app.fail(403, 'Only admins and the person who added this module can assign people to it.'); end if;
  ids := case when jsonb_typeof(body->'user_ids') = 'array' then body->'user_ids' else '[]'::jsonb end;
  if jsonb_array_length(ids) > 0 then
    mid := case when it.level = 'module' then it.id else it.parent_id end;
    why := app.module_not_ready(mid);
    if why is not null then perform app.fail(400, why); end if;
  end if;
  res := app.set_assignees(iid, ids, body->'lead_id', me.id);
  perform app.audit(it.project_id, it.level, iid, 'assigned', 'now: ' || app.user_names(app.assignee_ids(iid)), me.id);
  select name into pname from app.projects where id = it.project_id;
  perform app.notify(array(select x::bigint from jsonb_array_elements_text(res->'added') x where x::bigint <> me.id), 'assigned',
    'You were assigned to ' || it.level || ' ' || it.name, pname,
    case when it.level = 'module' then '/projects/' || it.project_id else '/items/' || iid end);
  perform app.after(it.project_id);
  return '{"ok":true}';
end $$;

-- Anyone on the team can put themselves on a module or feature to show their part in it. No approval; admins are told.
create or replace function app.r_item_join(me app.users, iid bigint) returns jsonb
language plpgsql as $$
declare it app.work_items; why text; pname text; mname text;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or not (it.project_id = any(app.visible_project_ids(me.id, me.role = 'admin'))) then perform app.fail(404, 'Item not found.'); end if;
  if (select status from app.projects where id = it.project_id) <> 'active' then perform app.fail(400, 'This project is not active.'); end if;
  if it.status in ('done','cancelled','on_hold') then perform app.fail(400, 'This ' || it.level || ' is closed.'); end if;
  if app.is_assigned(me.id, iid) then perform app.fail(400, 'You are already on this ' || it.level || '.'); end if;
  if it.level = 'feature' and me.id = any(app.effective_assignees(iid)) then
    perform app.fail(400, 'You are already on this feature through its module team.');
  end if;
  why := app.module_not_ready(case when it.level = 'module' then it.id else it.parent_id end);
  if why is not null then perform app.fail(400, 'This module is not planned yet, so nobody can join it.'); end if;
  if it.level = 'feature' and not exists (select 1 from app.assignments where work_item_id = iid) then
    -- The feature belonged to the whole module team: keep them on it alongside the new person.
    insert into app.assignments (work_item_id, user_id, is_lead, assigned_by)
    select iid, a.user_id, a.is_lead, a.assigned_by from app.assignments a join app.users u on u.id = a.user_id and u.active
    where a.work_item_id = it.parent_id
    on conflict (work_item_id, user_id) do nothing;
  end if;
  insert into app.assignments (work_item_id, user_id, is_lead, assigned_by)
  values (iid, me.id, not exists (select 1 from app.assignments where work_item_id = iid), me.id)
  on conflict (work_item_id, user_id) do nothing;
  select name into pname from app.projects where id = it.project_id;
  select name into mname from app.work_items where id = it.parent_id;
  perform app.audit(it.project_id, it.level, iid, 'joined', me.name || ' joined', me.id);
  perform app.notify(array(select x from unnest(app.admin_ids()) x where x <> me.id), 'joined',
    me.name || ' joined ' || it.level || ' ' || it.name,
    pname || case when mname is not null then ' / ' || mname else '' end,
    case when it.level = 'module' then '/projects/' || it.project_id else '/items/' || iid end);
  perform app.after(it.project_id);
  return '{"ok":true}';
end $$;

-- People can step off work they put themselves on. Work an admin or the module's author gave them stays theirs.
create or replace function app.r_item_leave(me app.users, iid bigint) returns jsonb
language plpgsql as $$
declare it app.work_items; a app.assignments; pname text; nxt bigint;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null then perform app.fail(404, 'Item not found.'); end if;
  select * into a from app.assignments where work_item_id = iid and user_id = me.id;
  if a.id is null then perform app.fail(400, 'You are not on this ' || it.level || '.'); end if;
  if a.assigned_by is distinct from me.id then
    perform app.fail(403, 'You were put on this by someone else. Ask an admin to take you off it.');
  end if;
  delete from app.assignments where id = a.id;
  if a.is_lead then
    select user_id into nxt from app.assignments where work_item_id = iid order by assigned_at, id limit 1;
    if nxt is not null then update app.assignments set is_lead = true where work_item_id = iid and user_id = nxt; end if;
  end if;
  select name into pname from app.projects where id = it.project_id;
  perform app.audit(it.project_id, it.level, iid, 'left', me.name || ' left', me.id);
  perform app.notify(array(select x from unnest(app.admin_ids()) x where x <> me.id), 'left',
    me.name || ' left ' || it.level || ' ' || it.name, pname, '/projects/' || it.project_id);
  perform app.after(it.project_id);
  return '{"ok":true}';
end $$;

-- ======================= item detail =======================
create or replace function app.r_item(me app.users, iid bigint) returns jsonb
language plpgsql as $$
declare it app.work_items; admin boolean := me.role = 'admin'; out_ jsonb; on_module boolean;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or not app.can_see(me.id, admin, iid) then perform app.fail(404, 'Item not found.'); end if;
  on_module := admin or app.is_assigned(me.id, iid);
  out_ := jsonb_build_object(
    'item', jsonb_build_object(
      'id', it.id, 'level', it.level, 'name', it.name, 'description', it.description, 'size', it.size, 'weight', it.weight,
      'status', it.status, 'status_reason', it.status_reason, 'origin', it.origin, 'proposal_reason', it.proposal_reason,
      'requires_proof', it.requires_proof, 'sent_back', it.sent_back, 'start_date', it.start_date, 'duration_days', it.duration_days,
      'end_date', it.end_date, 'original_end_date', it.original_end_date, 'planned_start', it.planned_start, 'planned_end', it.planned_end,
      'manual_dates', it.manual_dates, 'work_pct', it.work_pct,
      'proposed_by', (select name from app.users where id = it.proposed_by))
      || case when it.level = 'module' and on_module then jsonb_build_object('progress_pct', it.progress_pct) else '{}'::jsonb end,
    'project', (select jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'company_name', c.name)
                from app.projects p join app.companies c on c.id = p.company_id where p.id = it.project_id),
    'module', (select jsonb_build_object('id', m.id, 'name', m.name, 'start_date', m.start_date, 'end_date', m.end_date, 'status', m.status, 'size', m.size)
               from app.work_items m where m.id = it.parent_id),
    'assignees', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'is_lead', a.is_lead) order by a.is_lead desc, u.name), '[]')
                  from app.assignments a join app.users u on u.id = a.user_id where a.work_item_id = iid),
    'submissions', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
                        'submitted_by_name', u.name, 'decided_by_name', d.name,
                        'files', (select coalesce(jsonb_agg(jsonb_build_object('id', sf.id, 'submission_id', sf.submission_id, 'kind', sf.kind, 'url', sf.url,
                                                     'file_name', sf.file_name, 'size_bytes', sf.size_bytes) order by sf.id), '[]')
                                  from app.submission_files sf where sf.submission_id = s.id))
                      order by s.id desc), '[]')
                    from app.submissions s join app.users u on u.id = s.submitted_by left join app.users d on d.id = s.decided_by
                    where s.work_item_id = iid),
    'logs', (select coalesce(jsonb_agg(x.j order by x.date desc, x.id desc), '[]') from (
               select e.id, l.date, jsonb_build_object('id', e.id, 'work_done', e.work_done, 'hours', e.hours, 'date', l.date, 'user_id', u.id, 'name', u.name) j
               from app.log_entries e join app.daily_logs l on l.id = e.log_id join app.users u on u.id = l.user_id
               where e.work_item_id = iid order by l.date desc, e.id desc limit 200) x),
    'comments', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('name', u.name) order by c.id), '[]')
                 from app.comments c join app.users u on u.id = c.user_id where c.work_item_id = iid),
    'progress_updates', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'from_pct', x.from_pct, 'to_pct', x.to_pct, 'note', x.note,
                           'at', x.at, 'name', u.name) order by x.id desc), '[]')
                         from app.progress_updates x join app.users u on u.id = x.user_id where x.work_item_id = iid),
    'can_work', it.level = 'feature' and app.can_work(me.id, admin, iid),
    'min_note_chars', app.setting_num('min_note_chars', 30));
  if it.level = 'module' then
    out_ := out_ || jsonb_build_object('features', (
      select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size, 'status', f.status,
                                'planned_start', f.planned_start, 'planned_end', f.planned_end, 'origin', f.origin) order by f.sequence, f.id), '[]')
      from app.work_items f where f.parent_id = iid and (on_module or app.is_assigned(me.id, f.id))));
  end if;
  if admin then
    out_ := out_ || jsonb_build_object(
      'facts', app.schedule_facts(it.level, iid),
      'flags', (select coalesce(jsonb_agg(to_jsonb(f) order by f.id), '[]') from app.flags f
                where f.cleared_at is null and f.entity_type in ('feature','module') and f.entity_id = iid),
      'effective', app.user_list(case when it.level = 'feature' then app.effective_assignees(iid) else app.assignee_ids(iid) end));
  end if;
  return out_;
end $$;

create or replace function app.r_comment(me app.users, iid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare it app.work_items; txt text; others bigint[];
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or not app.can_see(me.id, me.role = 'admin', iid) then perform app.fail(404, 'Item not found.'); end if;
  txt := app.v_str(body->'body', 4000, true, 'Comment');
  insert into app.comments (work_item_id, user_id, body) values (iid, me.id, txt);
  others := array(select x from unnest(app.assignee_ids(iid) || case when it.parent_id is not null then app.assignee_ids(it.parent_id) else '{}'::bigint[] end) x where x <> me.id);
  if me.role <> 'admin' then others := array(select x from unnest(others || app.admin_ids()) x where x <> me.id); end if;
  perform app.notify(others, 'comment', me.name || ' commented on ' || it.name, left(txt, 140), '/items/' || iid);
  return '{"ok":true}';
end $$;

-- ======================= completion: submit & review =======================
create or replace function app.decide(sub_id bigint, p_decision text, p_reason text, actor bigint, auto boolean default false) returns bigint
language plpgsql as $$
declare s app.submissions; it app.work_items;
begin
  select * into s from app.submissions where id = sub_id;
  select * into it from app.work_items where id = s.work_item_id;
  update app.submissions set decision = p_decision, decided_by = actor, reason = p_reason, decided_at = now() where id = sub_id;
  if p_decision = 'approved' then
    update app.work_items set status = 'done', sent_back = false, completed_at = app.app_now() where id = it.id;
  else
    update app.work_items set status = 'in_progress', sent_back = true where id = it.id;
  end if;
  perform app.audit(it.project_id, 'feature', it.id,
    case when p_decision = 'approved' then case when auto then 'auto-approved' else 'approved' end else 'sent back' end, p_reason, actor);
  if not auto then
    perform app.notify(array[s.submitted_by] || app.effective_assignees(it.id), p_decision,
      case when p_decision = 'approved' then it.name || ' was approved' else it.name || ' was sent back' end, p_reason, '/items/' || it.id);
  end if;
  return it.project_id;
end $$;

-- body: { note, links: [...], files: [{ path, name, mime, size }] }  (files are already in Storage)
create or replace function app.r_submit(me app.users, iid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare
  it app.work_items; p app.projects; min_chars int; note text; links text[] := '{}'; l text; raw jsonb; files jsonb;
  f jsonb; sub_id bigint; admin boolean := me.role = 'admin'; parsed jsonb; nfiles int;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or it.level <> 'feature' or not app.can_see(me.id, admin, iid) then perform app.fail(404, 'Feature not found.'); end if;
  if not app.can_work(me.id, admin, iid) then perform app.fail(403, 'You are not assigned to this feature.'); end if;
  if it.status = 'proposed' then perform app.fail(400, 'An admin needs to accept this feature before it can be submitted.'); end if;
  if it.status not in ('not_started','in_progress','blocked') then
    perform app.fail(400, 'This feature is ' || regexp_replace(it.status, '_', ' ') || ' and cannot be submitted.');
  end if;
  min_chars := app.setting_num('min_note_chars', 30);
  note := app.v_str(body->'note', 6000, true, 'Completion note');
  if length(note) < min_chars then perform app.fail(400, 'Describe what you did in at least ' || min_chars || ' characters.'); end if;

  raw := body->'links';
  if jsonb_typeof(raw) = 'string' then
    begin parsed := (raw #>> '{}')::jsonb; exception when others then parsed := null; end;
    if jsonb_typeof(parsed) = 'array' then raw := parsed;
    else raw := to_jsonb(regexp_split_to_array(raw #>> '{}', '\s+')); end if;
  end if;
  if jsonb_typeof(raw) = 'array' then
    links := array(select app.trim_ws(x #>> '{}') from jsonb_array_elements(raw) x where app.trim_ws(x #>> '{}') <> '');
  end if;
  foreach l in array links loop
    if l !~* '^https?://\S+$' or length(l) > 1000 then
      perform app.fail(400, '"' || left(l, 60) || '" is not a valid link. Links must start with http:// or https://.');
    end if;
  end loop;

  files := case when jsonb_typeof(body->'files') = 'array' then body->'files' else '[]'::jsonb end;
  nfiles := jsonb_array_length(files);
  if nfiles > 10 then perform app.fail(400, 'Attach at most 10 files.'); end if;
  for f in select * from jsonb_array_elements(files) loop
    if coalesce(f->>'path', '') !~ ('^' || me.auth_id::text || '/') or not exists (
         select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = f->>'path') then
      perform app.fail(400, 'One of the attached files did not upload. Attach it again.');
    end if;
    if coalesce((f->>'size')::numeric, 0) > 25 * 1024 * 1024 then perform app.fail(400, 'Each file must be 25 MB or smaller.'); end if;
  end loop;
  if it.requires_proof and nfiles = 0 and cardinality(links) = 0 then
    perform app.fail(400, 'This feature needs proof: attach a document or add a link.');
  end if;

  select * into p from app.projects where id = it.project_id;
  insert into app.submissions (work_item_id, submitted_by, note) values (iid, me.id, note) returning id into sub_id;
  for f in select * from jsonb_array_elements(files) loop
    insert into app.submission_files (submission_id, kind, url, file_name, stored_name, mime_type, size_bytes)
    values (sub_id, 'file', null, left(coalesce(f->>'name', 'file'), 255), f->>'path', f->>'mime', (f->>'size')::bigint);
  end loop;
  foreach l in array links loop
    insert into app.submission_files (submission_id, kind, url) values (sub_id, 'link', l);
  end loop;
  update app.work_items set status = 'submitted', sent_back = false, work_pct = 100, started_at = coalesce(started_at, app.app_now()) where id = iid;
  insert into app.progress_updates (work_item_id, user_id, from_pct, to_pct, note) values (iid, me.id, it.work_pct, 100, note);
  perform app.audit(it.project_id, 'feature', iid, 'submitted', nfiles || ' file(s), ' || cardinality(links) || ' link(s)', me.id);
  if p.auto_approve then
    perform app.decide(sub_id, 'approved', null, me.id, true);
  else
    perform app.notify(app.admin_ids(), 'submitted', me.name || ' submitted ' || it.name || ' for review', left(note, 140), '/reviews');
  end if;
  perform app.after(it.project_id);
  return jsonb_build_object('ok', true, 'auto_approved', p.auto_approve);
end $$;

create or replace function app.r_decide(me app.users, sid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare s app.submissions; dec text; reason text; pid bigint;
begin
  perform app.require_admin(me);
  select * into s from app.submissions where id = sid;
  if s.id is null then perform app.fail(404, 'Submission not found.'); end if;
  if s.decision is not null then perform app.fail(400, 'This submission has already been reviewed.'); end if;
  dec := case app.jtext(body->'decision') when 'approve' then 'approved' when 'reject' then 'rejected' end;
  if dec is null then perform app.fail(400, 'Choose approve or send back.'); end if;
  reason := app.v_str(body->'reason', 2000, dec = 'rejected', 'Reason for sending back');
  pid := app.decide(sid, dec, reason, me.id);
  perform app.after(pid);
  return '{"ok":true}';
end $$;

-- Where a file lives, after checking the viewer may see it. The browser then asks Storage for a short-lived link.
create or replace function app.r_file(me app.users, fid bigint) returns jsonb
language plpgsql as $$
declare r record;
begin
  select sf.*, s.work_item_id into r from app.submission_files sf join app.submissions s on s.id = sf.submission_id
  where sf.id = fid and sf.kind = 'file';
  if r.id is null or not app.can_see(me.id, me.role = 'admin', r.work_item_id) then perform app.fail(404, 'File not found.'); end if;
  return jsonb_build_object('path', r.stored_name, 'file_name', r.file_name);
end $$;

-- ======================= bulk import =======================
create or replace function app.r_import(me app.users, body jsonb) returns jsonb
language plpgsql as $$
declare
  rows_ jsonb; raw jsonb; i int := 0; rn int; errors jsonb := '[]'; clean jsonb := '[]'; o jsonb; e text; u app.users;
  c app.companies; p app.projects; m app.work_items; fid bigint; touched bigint[] := '{}'; seq int; summary jsonb; asg text[];
  g_venture text; g_project text; g_module text; g_msize text; g_mstart text; g_mdays text; g_feature text; g_fsize text;
begin
  perform app.require_admin(me);
  rows_ := case when jsonb_typeof(body->'rows') = 'array' then body->'rows' else '[]'::jsonb end;
  if jsonb_array_length(rows_) = 0 then perform app.fail(400, 'The file has no rows.'); end if;
  if jsonb_array_length(rows_) > 2000 then perform app.fail(400, 'Import at most 2,000 rows at a time.'); end if;
  for raw in select * from jsonb_array_elements(rows_) loop
    i := i + 1; rn := i + 1;  -- header is row 1
    g_venture := app.trim_ws(app.jtext(raw->'venture'));
    g_project := app.trim_ws(app.jtext(raw->'project'));
    g_module := app.trim_ws(app.jtext(raw->'module'));
    g_msize := lower(app.trim_ws(app.jtext(raw->'module_size')));
    g_mstart := app.trim_ws(app.jtext(raw->'module_start'));
    g_mdays := app.trim_ws(app.jtext(raw->'module_days'));
    g_feature := app.trim_ws(app.jtext(raw->'feature'));
    g_fsize := coalesce(nullif(lower(app.trim_ws(app.jtext(raw->'feature_size'))), ''), 'medium');
    asg := array(select lower(app.trim_ws(x)) from unnest(regexp_split_to_array(app.trim_ws(app.jtext(raw->'assignees')), '[;,]')) x
                 where app.trim_ws(x) <> '');
    if g_venture = '' then errors := errors || jsonb_build_object('row', rn, 'message', 'Venture is empty.'); end if;
    if g_project = '' then errors := errors || jsonb_build_object('row', rn, 'message', 'Project is empty.'); end if;
    if g_module = '' then errors := errors || jsonb_build_object('row', rn, 'message', 'Module is empty.'); end if;
    if g_feature = '' then errors := errors || jsonb_build_object('row', rn, 'message', 'Every row needs a feature. Modules must list their features.'); end if;
    if g_msize not in ('small','medium','large') then errors := errors || jsonb_build_object('row', rn, 'message', 'Module size must be small, medium or large.'); end if;
    if g_fsize not in ('small','medium','large') then errors := errors || jsonb_build_object('row', rn, 'message', 'Feature size must be small, medium or large.'); end if;
    if not app.is_valid_date(g_mstart) then errors := errors || jsonb_build_object('row', rn, 'message', 'Module start must be a date like 2026-10-12.'); end if;
    if g_mdays !~ '^\d+$' or g_mdays::numeric < 1 then errors := errors || jsonb_build_object('row', rn, 'message', 'Module days must be a whole number of working days.'); end if;
    foreach e in array asg loop
      select * into u from app.users where lower(email) = e;
      if u.id is null then errors := errors || jsonb_build_object('row', rn, 'message', e || ' is not in the system yet. Add them on the People page first.');
      elsif not u.active then errors := errors || jsonb_build_object('row', rn, 'message', e || ' is deactivated.'); end if;
    end loop;
    clean := clean || jsonb_build_object('venture', g_venture, 'project', g_project, 'module', g_module, 'module_size', g_msize,
      'module_start', g_mstart, 'module_days', g_mdays, 'feature', g_feature, 'feature_size', g_fsize, 'assignees', to_jsonb(asg));
  end loop;
  if jsonb_array_length(errors) > 0 then return jsonb_build_object('ok', false, 'errors', errors); end if;

  select jsonb_build_object(
    'ventures', count(distinct lower(x->>'venture')),
    'projects', count(distinct lower(x->>'venture') || '|' || lower(x->>'project')),
    'modules', count(distinct lower(x->>'venture') || '|' || lower(x->>'project') || '|' || lower(x->>'module')),
    'features', count(*)) into summary
  from jsonb_array_elements(clean) x;
  if not app.v_bool(body->'commit') then return jsonb_build_object('ok', true, 'preview', summary); end if;

  for o in select * from jsonb_array_elements(clean) loop
    select * into c from app.companies where lower(name) = lower(o->>'venture');
    if c.id is null then
      insert into app.companies (name, weekly_offs) values (o->>'venture', app.setting('default_weekly_offs', '0')) returning * into c;
    end if;
    select * into p from app.projects where company_id = c.id and lower(name) = lower(o->>'project');
    if p.id is null then
      insert into app.projects (company_id, name, created_by) values (c.id, o->>'project', me.id) returning * into p;
      perform app.audit(p.id, 'project', p.id, 'imported', o->>'project', me.id);
    end if;
    select * into m from app.work_items where project_id = p.id and level = 'module' and lower(name) = lower(o->>'module');
    if m.id is null then
      select coalesce(max(sequence), 0) + 1 into seq from app.work_items where project_id = p.id and level = 'module';
      insert into app.work_items (project_id, level, name, size, weight, sequence, start_date, duration_days, created_by)
      values (p.id, 'module', o->>'module', o->>'module_size', app.weight_for(c.id, o->>'module_size'), seq,
              (o->>'module_start')::date, (o->>'module_days')::int, me.id)
      returning * into m;
    end if;
    select id into fid from app.work_items where parent_id = m.id and lower(name) = lower(o->>'feature');
    if fid is null then
      fid := app.insert_feature(p.id, m.id, c.id, jsonb_build_object('name', o->>'feature', 'size', o->>'feature_size'), 'admin', 'not_started', me.id);
    end if;
    insert into app.assignments (work_item_id, user_id, assigned_by)
    select fid, u2.id, me.id from jsonb_array_elements_text(o->'assignees') em join app.users u2 on lower(u2.email) = em
    on conflict (work_item_id, user_id) do nothing;
    if not (p.id = any(touched)) then touched := touched || p.id; end if;
    c := null; p := null; m := null; fid := null;
  end loop;
  foreach fid in array touched loop perform app.recalc_project(fid); end loop;
  perform app.refresh_flags();
  return jsonb_build_object('ok', true, 'imported', summary);
end $$;
