-- ======================= progress percentage and deleting =======================

-- body: { pct: 0..100, note }.  Every change needs a note. Reaching 100 sends the feature for review.
create or replace function app.r_item_progress(me app.users, iid bigint, body jsonb) returns jsonb
language plpgsql as $$
declare it app.work_items; admin boolean := me.role = 'admin'; pct int; note text; raw text;
begin
  select * into it from app.work_items where id = iid;
  if it.id is null or it.level <> 'feature' or not app.can_see(me.id, admin, iid) then perform app.fail(404, 'Feature not found.'); end if;
  if not app.can_work(me.id, admin, iid) then perform app.fail(403, 'You are not assigned to this feature.'); end if;
  if it.status = 'proposed' then perform app.fail(400, 'An admin needs to accept this feature before you can report progress on it.'); end if;
  if it.status not in ('not_started','in_progress','blocked') then
    perform app.fail(400, 'This feature is ' || regexp_replace(it.status, '_', ' ') || ', so its percentage cannot be changed.');
  end if;
  raw := app.jtext(body->'pct');
  if raw is null or raw !~ '^\d{1,3}$' or raw::int > 100 then perform app.fail(400, 'Percentage must be a whole number from 0 to 100.'); end if;
  pct := raw::int;
  note := app.v_str(body->'note', 6000, true, 'Progress note');
  if pct = it.work_pct and it.status <> 'in_progress' then perform app.fail(400, 'That is already the current percentage.'); end if;
  if pct = 100 then
    -- Finishing is a submission: same note, documents and proof rules.
    return app.r_submit(me, iid, body);
  end if;
  if pct = it.work_pct then perform app.fail(400, 'That is already the current percentage.'); end if;
  update app.work_items set work_pct = pct,
    status = case when status = 'not_started' then 'in_progress' else status end,
    started_at = coalesce(started_at, app.app_now())
  where id = iid;
  insert into app.progress_updates (work_item_id, user_id, from_pct, to_pct, note) values (iid, me.id, it.work_pct, pct, note);
  perform app.audit(it.project_id, 'feature', iid, 'progress ' || it.work_pct || '% → ' || pct || '%', note, me.id);
  perform app.after(it.project_id);
  return jsonb_build_object('ok', true, 'work_pct', pct);
end $$;

-- Admin only. Removes a feature, or a module with all its features, submissions, comments and history.
create or replace function app.r_item_delete(me app.users, iid bigint) returns jsonb
language plpgsql as $$
declare it app.work_items; ids bigint[]; who bigint[]; pname text;
begin
  perform app.require_admin(me);
  select * into it from app.work_items where id = iid;
  if it.id is null then perform app.fail(404, 'Item not found.'); end if;
  ids := array(select id from app.work_items where id = iid or parent_id = iid);
  who := array(select distinct a.user_id from app.assignments a where a.work_item_id = any(ids) and a.user_id <> me.id);
  select name into pname from app.projects where id = it.project_id;
  delete from app.flags where entity_type in ('feature','module') and entity_id = any(ids);
  delete from app.work_items where id = iid;
  perform app.audit(it.project_id, it.level, iid, 'deleted', it.name, me.id);
  perform app.notify(who, 'deleted', it.name || ' was removed', pname, '/projects/' || it.project_id);
  perform app.after(it.project_id);
  return jsonb_build_object('ok', true, 'project_id', it.project_id);
end $$;
