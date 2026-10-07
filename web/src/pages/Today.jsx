import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Status, Size, fmtDate, Field, useAction, Empty } from '../ui.jsx';
import { SubmitModal, BlockModal } from './workActions.jsx';

const BUCKETS = {
  overdue: { title: 'Overdue', hint: 'Past its planned finish. Finish and submit, or tell your admin what is in the way.' },
  sent_back: { title: 'Sent back', hint: 'Your admin asked for changes.' },
  due_today: { title: 'Due today', hint: 'Finish and submit today.' },
  in_window: { title: 'Working on', hint: 'In its planned window.' },
  blocked: { title: 'Blocked', hint: 'Follow up on what it is waiting for.' },
  up_next: { title: 'Up next', hint: 'Nothing is due, so start this.' },
  adhoc: { title: 'Added by your admin', hint: 'One-off tasks for today.' },
};
const HOURS = Array.from({ length: 33 }, (_, i) => i / 2);

function Hours({ value, onChange, disabled }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} aria-label="Hours">
      {HOURS.map((h) => (
        <option key={h} value={h}>
          {h === 0 ? 'Hours' : `${h} h`}
        </option>
      ))}
    </select>
  );
}

export default function Today() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || '';
  const day = useApi(`/me/today${date ? `?date=${date}` : ''}`);
  const work = useApi('/me/work');
  const [lines, setLines] = useState({});
  const [extra, setExtra] = useState([]);
  const [blockers, setBlockers] = useState('');
  const [plan, setPlan] = useState('');
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState(null);
  const { busy, error, run } = useAction();

  // Load saved entries into the form.
  useEffect(() => {
    const d = day.data;
    if (!d) return;
    const byTarget = {};
    const rest = [];
    for (const e of d.entries) {
      const t = d.targets.find((x) => x.id === e.target_id) || (e.work_item_id && d.targets.find((x) => x.work_item_id === e.work_item_id && !byTarget[x.id]));
      if (t && !byTarget[t.id]) byTarget[t.id] = { work_done: e.work_done, hours: e.hours };
      else rest.push({ work_item_id: e.work_item_id || '', category: e.category || 'Meeting', work_done: e.work_done, hours: e.hours });
    }
    setLines(byTarget);
    setExtra(rest);
    setBlockers(d.log?.blockers || '');
    setPlan(d.log?.tomorrow_plan || '');
    setDirty(false);
  }, [day.data]);

  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const d = day.data;
  const groups = useMemo(() => {
    const g = {};
    for (const t of d?.targets || []) (g[t.bucket] ||= []).push(t);
    return g;
  }, [d]);
  const targetItemIds = new Set((d?.targets || []).map((t) => t.work_item_id).filter(Boolean));
  const otherFeatures = (work.data?.open || []).filter((f) => !targetItemIds.has(f.id));
  const total = Object.values(lines).reduce((s, l) => s + (Number(l.hours) || 0), 0) + extra.reduce((s, l) => s + (Number(l.hours) || 0), 0);

  if (day.loading && !d) return <Loading />;
  if (day.error) return <ErrorBox error={day.error} />;

  const locked = d.locked;
  const submitted = !!d.log?.submitted_at;
  const isToday = d.date === d.today;
  const setLine = (id, k, v) => {
    setLines({ ...lines, [id]: { work_done: '', hours: 0, ...lines[id], [k]: v } });
    setDirty(true);
  };
  const setExtraLine = (i, k, v) => {
    setExtra(extra.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    setDirty(true);
  };

  const save = async (submit) => {
    const entries = [
      ...d.targets.filter((t) => lines[t.id]?.work_done || lines[t.id]?.hours).map((t) => ({ target_id: t.id, ...lines[t.id] })),
      ...extra.map((l) => (l.work_item_id ? { work_item_id: Number(l.work_item_id), work_done: l.work_done, hours: l.hours } : { category: l.category, work_done: l.work_done, hours: l.hours })),
    ];
    const ok = await run(() => api.put(`/me/log/${d.date}`, { entries, blockers, tomorrow_plan: plan, submit }), submit ? 'Day submitted' : 'Saved');
    if (ok) {
      setDirty(false);
      day.reload();
      work.reload();
    }
  };

  const reloadAll = () => {
    day.reload();
    work.reload();
  };

  return (
    <>
      <div className="head">
        <div>
          <div className="crumbs">{isToday ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}` : 'Earlier day'}</div>
          <h1>{isToday ? 'Today' : fmtDate(d.date)}</h1>
          <div className="sub">
            {fmtDate(d.date)}. {d.targets.length} target{d.targets.length === 1 ? '' : 's'}
            {submitted ? ', log submitted' : ''}
            {locked ? ', locked' : ''}.
          </div>
        </div>
        <div className="actions">
          <input
            type="date"
            className="input"
            style={{ width: 'auto' }}
            max={d.today}
            value={d.date}
            onChange={(e) => setParams(e.target.value && e.target.value !== d.today ? { date: e.target.value } : {})}
            aria-label="Open another day"
          />
          {!isToday && (
            <button className="btn" onClick={() => setParams({})}>
              Back to today
            </button>
          )}
        </div>
      </div>

      {!d.is_working_day && <div className="note">This is a day off on the group calendar. You can still log work if you did any.</div>}
      {locked && <div className="note">This log is locked. Logs can be edited until 11:00 AM on the next working day.</div>}
      <ErrorBox error={error} />

      {!d.targets.length && (
        <div className="panel">
          <Empty title="No targets for this day">{isToday ? 'Nothing is planned for you yet. Log any work you did below, or check My work.' : 'Nothing was planned for you on this day.'}</Empty>
        </div>
      )}

      {Object.keys(BUCKETS)
        .filter((b) => groups[b])
        .map((b) => (
          <section key={b}>
            <div className="bucket">
              <h3>{BUCKETS[b].title}</h3>
              <span className="small muted">{BUCKETS[b].hint}</span>
            </div>
            {groups[b].map((t) => {
              const l = lines[t.id] || { work_done: '', hours: 0 };
              const feature = { id: t.work_item_id, name: t.feature_name, requires_proof: !!t.requires_proof };
              const canAct = t.work_item_id && ['not_started', 'in_progress', 'blocked'].includes(t.status) && !locked;
              return (
                <div key={t.id} className={`target ${t.bucket}`}>
                  <div className="tt">
                    <div style={{ minWidth: 0 }}>
                      {t.work_item_id ? (
                        <Link className="tn" to={`/items/${t.work_item_id}`}>
                          {t.feature_name}
                        </Link>
                      ) : (
                        <span className="tn">{t.adhoc_title}</span>
                      )}
                      <div className="tw">
                        {t.work_item_id ? (
                          <>
                            {t.project_name} / {t.module_name}. Planned {fmtDate(t.planned_start)} to {fmtDate(t.planned_end)}.
                            {t.partners && <> With {t.partners}.</>}
                          </>
                        ) : (
                          <>From {t.created_by_name}</>
                        )}
                      </div>
                    </div>
                    {t.work_item_id && (
                      <div className="gap8">
                        <Size s={t.size} />
                        <Status s={t.status} sentBack={t.sent_back} />
                      </div>
                    )}
                  </div>
                  {!!t.sent_back && t.sent_back_reason && t.status === 'in_progress' && <div className="why">Sent back by your admin: {t.sent_back_reason}</div>}
                  {t.status === 'proposed' && <div className="note mt8 mb8">Waiting for an admin to accept this feature. You can log work on it meanwhile.</div>}
                  <div className="logline">
                    <textarea
                      className="input"
                      rows={2}
                      placeholder={t.work_item_id ? 'What did you do on this today?' : 'Notes'}
                      value={l.work_done}
                      onChange={(e) => setLine(t.id, 'work_done', e.target.value)}
                      disabled={locked}
                      aria-label={`Work done on ${t.feature_name || t.adhoc_title}`}
                    />
                    <Hours value={l.hours} onChange={(v) => setLine(t.id, 'hours', v)} disabled={locked} />
                  </div>
                  {canAct && (
                    <div className="gap8 mt8">
                      <button className="btn sm primary" onClick={() => setModal({ kind: 'submit', feature })}>
                        Mark as done
                      </button>
                      {t.status !== 'blocked' && (
                        <button className="btn sm" onClick={() => setModal({ kind: 'block', feature })}>
                          I'm blocked
                        </button>
                      )}
                      {t.status === 'blocked' && (
                        <button className="btn sm" onClick={() => run(() => api.post(`/items/${t.work_item_id}/status`, { status: 'in_progress' }), 'Unblocked').then(reloadAll)}>
                          No longer blocked
                        </button>
                      )}
                    </div>
                  )}
                  {t.status === 'submitted' && <div className="small muted mt8">Sent for review. You will be notified when it is approved.</div>}
                  {t.status === 'done' && <div className="small muted mt8">Approved.</div>}
                </div>
              );
            })}
          </section>
        ))}

      <section>
        <div className="bucket">
          <h3>Anything else</h3>
          <span className="small muted">Other assigned work, meetings, support.</span>
        </div>
        <div className="panel">
          <div className="pb">
            {extra.map((l, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <select
                    className="input"
                    value={l.work_item_id ? `f${l.work_item_id}` : `c${l.category}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setExtra(extra.map((x, j) => (j === i ? { ...x, work_item_id: v[0] === 'f' ? v.slice(1) : '', category: v[0] === 'c' ? v.slice(1) : x.category } : x)));
                      setDirty(true);
                    }}
                    disabled={locked}
                    aria-label="What this was for"
                  >
                    <optgroup label="Other work">
                      {d.categories.map((c) => (
                        <option key={c} value={`c${c}`}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                    {otherFeatures.length > 0 && (
                      <optgroup label="My assigned features">
                        {otherFeatures.map((f) => (
                          <option key={f.id} value={`f${f.id}`}>
                            {f.name} ({f.project_name})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div style={{ flex: '3 1 280px' }}>
                  <textarea className="input" rows={1} value={l.work_done} onChange={(e) => setExtraLine(i, 'work_done', e.target.value)} placeholder="What you did" disabled={locked} aria-label="What you did" />
                </div>
                <div style={{ flex: '0 0 96px' }}>
                  <Hours value={l.hours} onChange={(v) => setExtraLine(i, 'hours', v)} disabled={locked} />
                </div>
                {!locked && (
                  <button className="btn ghost sm" onClick={() => (setExtra(extra.filter((_, j) => j !== i)), setDirty(true))} aria-label="Remove line">
                    Remove
                  </button>
                )}
                <div style={{ flexBasis: '100%', height: 10 }} />
              </div>
            ))}
            {!locked && (
              <button className="btn sm" onClick={() => setExtra([...extra, { work_item_id: '', category: 'Meeting', work_done: '', hours: 0 }])}>
                Add a line
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mt24">
        <div className="row wide-fields">
          <Field label="Blockers" hint="optional">
            <textarea className="input" rows={2} value={blockers} onChange={(e) => (setBlockers(e.target.value), setDirty(true))} disabled={locked} />
          </Field>
          <Field label="Plan for tomorrow" hint="optional">
            <textarea className="input" rows={2} value={plan} onChange={(e) => (setPlan(e.target.value), setDirty(true))} disabled={locked} />
          </Field>
        </div>
      </section>

      {!locked && (
        <div className="stickybar">
          <span className="small muted">
            <span className="num" style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>
              {total}
            </span>{' '}
            hours logged{dirty ? ', unsaved changes' : ''}
          </span>
          <button className="btn" disabled={busy} onClick={() => save(false)}>
            Save draft
          </button>
          <button className="btn primary" disabled={busy} onClick={() => save(true)}>
            {submitted ? 'Update submitted log' : 'Submit day'}
          </button>
        </div>
      )}

      {modal?.kind === 'submit' && (
        <SubmitModal
          feature={modal.feature}
          minChars={d.min_note_chars}
          onClose={() => setModal(null)}
          onDone={async () => {
            if (dirty) await save(false);
            reloadAll();
          }}
        />
      )}
      {modal?.kind === 'block' && <BlockModal feature={modal.feature} onClose={() => setModal(null)} onDone={reloadAll} />}
    </>
  );
}
