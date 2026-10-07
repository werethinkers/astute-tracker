import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  useApi, Loading, ErrorBox, Status, Size, Avatars, PlanLine, PlanLegend, Health, DaysLeft, fmtDate, fmtDateY, fmtWhen, Empty, useToast,
} from '../ui.jsx';
import { ProjectForm, ModuleForm, ModuleEdit, FeatureForm, AssignModal, ReasonModal } from './adminForms.jsx';
import { ProposeModal } from './workActions.jsx';

function Timeline({ modules }) {
  const dated = modules.filter((m) => m.start_date && m.end_date && m.status !== 'cancelled');
  if (!dated.length) return <Empty title="Nothing scheduled">Modules appear here once they have dates.</Empty>;
  const day = (d) => Date.parse(d + 'T00:00:00Z') / 864e5;
  const lo = Math.min(...dated.map((m) => day(m.start_date)));
  const hi = Math.max(...dated.map((m) => day(m.end_date))) + 1;
  const todayD = day(new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10));
  const X = (d) => `${((d - lo) / (hi - lo)) * 100}%`;
  const ticks = [];
  const step = hi - lo > 70 ? 14 : 7;
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  const label = (t) => fmtDate(new Date(t * 864e5).toISOString().slice(0, 10)).replace(/^\w+,?\s/, '');
  return (
    <div className="gantt">
      <div className="axis">
        <span />
        <div className="ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: X(t) }}>
              {label(t)}
            </span>
          ))}
        </div>
      </div>
      {dated.map((m) => (
        <div className="gr" key={m.id}>
          <div className="gl" title={m.name}>
            {m.name}
          </div>
          <div className="gt">
            {todayD >= lo && todayD <= hi && <div className="today" style={{ left: X(todayD + 0.5) }} title="Today" />}
            <div
              className="gb"
              style={{ left: X(day(m.start_date)), width: `calc(${X(day(m.end_date) + 1)} - ${X(day(m.start_date))})` }}
              title={`${m.name}: ${fmtDate(m.start_date)} to ${fmtDate(m.end_date)}, ${Math.round(m.progress_pct || 0)}% done`}
            >
              <div className="gf" style={{ width: `${m.progress_pct || 0}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureRow({ f, admin, onAction }) {
  return (
    <div className={`feature${f.status === 'proposed' ? ' proposed' : ''}`}>
      <Size s={f.size} />
      <div style={{ minWidth: 0 }}>
        <Link className="fname" to={`/items/${f.id}`}>
          {f.name}
        </Link>
        {f.origin === 'workforce' && <span className="tag" style={{ marginLeft: 8 }}>added by team</span>}
        {f.requires_proof && <span className="tag" style={{ marginLeft: 6 }}>needs proof</span>}
        <div className="sub">
          {f.assignees.length ? f.assignees.map((a) => a.name).join(', ') : f.effective.length ? `${f.effective.join(', ')} (module team)` : 'Nobody assigned'}
          {f.planned_end && <> · {fmtDate(f.planned_start)} to {fmtDate(f.planned_end)}</>}
          {f.last_log && <> · last log {fmtDate(f.last_log)}</>}
        </div>
        {admin && f.flags?.length > 0 && (
          <div className="gap8 mt8">
            {f.flags.map((fl) => (
              <span key={fl.id} className={`sev ${fl.severity}`}>
                {fl.title}
              </span>
            ))}
          </div>
        )}
        {f.status === 'blocked' && f.status_reason && <div className="tiny" style={{ color: 'var(--red)' }}>Waiting on: {f.status_reason}</div>}
        {f.status === 'proposed' && f.proposal_reason && <div className="tiny muted">Why: {f.proposal_reason}</div>}
      </div>
      <Status s={f.status} sentBack={f.sent_back} />
      <div className="gap8">
        {admin && f.status === 'proposed' && (
          <Link className="btn sm" to="/reviews">
            Review
          </Link>
        )}
        {admin && f.status !== 'proposed' && (
          <>
            <button className="btn sm ghost" onClick={() => onAction('assign-f', f)}>
              Assign
            </button>
            <button className="btn sm ghost" onClick={() => onAction('edit-f', f)}>
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ModuleBlock({ m, admin, me, open, onToggle, onAction }) {
  const counted = m.features.filter((f) => !['proposed', 'cancelled'].includes(f.status));
  const doneN = counted.filter((f) => f.status === 'done').length;
  const onTeam = m.assignees.some((a) => a.id === me.id);
  return (
    <div className={`module${open ? ' open' : ''}`}>
      <div className="mh" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())} aria-expanded={open}>
        <span className="chev" aria-hidden="true">
          ▶
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="gap8">
            <Size s={m.size} />
            <strong style={{ color: 'var(--ink)' }}>{m.name}</strong>
            {m.status !== 'in_progress' && m.status !== 'not_started' && <Status s={m.status} />}
            {admin && m.flags?.length > 0 && <span className={`sev ${m.flags.some((x) => x.severity === 'red') ? 'red' : 'amber'}`}>{m.flags.length} flag{m.flags.length > 1 ? 's' : ''}</span>}
          </div>
          <div className="meta">
            {m.limited ? (
              <span>You see only your features in this module. Due {fmtDate(m.end_date)}.</span>
            ) : (
              <>
                <Avatars people={m.assignees} />
                <span>
                  {fmtDate(m.start_date)} to {fmtDate(m.end_date)}
                  {m.original_end_date && m.original_end_date !== m.end_date && <span title="Original deadline"> (was {fmtDate(m.original_end_date)})</span>}
                </span>
                <span>
                  {doneN} of {counted.length} features done
                </span>
                {admin && <Health h={m.health} />}
              </>
            )}
          </div>
        </div>
        {m.progress_pct != null ? <PlanLine done={m.progress_pct} review={m.pending_pct} expected={admin ? m.expected_pct : undefined} /> : <span />}
        <span className="small">{admin ? <DaysLeft n={m.days_left} end={m.end_date} /> : null}</span>
      </div>
      {open && (
        <div className="mb">
          {m.description && <div className="pb small muted" style={{ paddingBottom: 0 }}>{m.description}</div>}
          {m.status_reason && ['on_hold', 'cancelled'].includes(m.status) && <div className="pb small">Reason: {m.status_reason}</div>}
          <div>
            {m.features.map((f) => (
              <FeatureRow key={f.id} f={f} admin={admin} onAction={(k, x) => onAction(k, x, m)} />
            ))}
          </div>
          <div className="gap8" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
            {admin ? (
              <>
                <button className="btn sm" onClick={() => onAction('add-f', null, m)}>
                  Add feature
                </button>
                <button className="btn sm" onClick={() => onAction('assign-m', m)}>
                  Assign people
                </button>
                <button className="btn sm" onClick={() => onAction('edit-m', m)}>
                  Edit module
                </button>
                {['on_hold', 'cancelled'].includes(m.status) ? (
                  <button className="btn sm" onClick={() => onAction('resume-m', m)}>
                    Resume
                  </button>
                ) : (
                  <>
                    <button className="btn sm ghost" onClick={() => onAction('hold-m', m)}>
                      Put on hold
                    </button>
                    <button className="btn sm ghost danger" onClick={() => onAction('cancel-m', m)}>
                      Cancel module
                    </button>
                  </>
                )}
              </>
            ) : (
              onTeam && !['done', 'cancelled', 'on_hold'].includes(m.status) && (
                <button className="btn sm" onClick={() => onAction('propose', m)}>
                  Add a feature
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Project() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/projects/${id}`);
  const activity = useApi(isAdmin ? `/projects/${id}/activity` : null, [data]);
  const [openIds, setOpenIds] = useState(null);
  const [tab, setTab] = useState('modules');
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const p = data.project;
  const mods = data.modules;
  const opened = openIds ?? new Set(mods.filter((m) => !['done', 'cancelled'].includes(m.status)).slice(0, 3).map((m) => m.id));
  const toggle = (mid) => {
    const s = new Set(opened);
    s.has(mid) ? s.delete(mid) : s.add(mid);
    setOpenIds(s);
  };
  const onAction = (kind, item, mod) => setModal({ kind, item, mod });
  const close = () => setModal(null);
  const statusAction = (itemId, status) => (reason) => api.post(`/items/${itemId}/status`, { status, reason });

  return (
    <>
      <div className="head">
        <div>
          <div className="crumbs">
            {isAdmin ? <Link to="/portfolio">Portfolio</Link> : <Link to="/projects">Projects</Link>} / {p.company_name}
          </div>
          <h1>{p.name}</h1>
          {p.description && <div className="sub">{p.description}</div>}
        </div>
        {isAdmin && (
          <div className="actions">
            <button className="btn" onClick={() => setModal({ kind: 'edit-p' })}>
              Edit project
            </button>
            <button className="btn primary" onClick={() => setModal({ kind: 'add-m' })}>
              Add module
            </button>
          </div>
        )}
      </div>

      {p.status !== 'active' && <div className="note">This project is {p.status.replace('_', ' ')}.</div>}

      {(isAdmin || p.progress_pct != null) && (
        <div className="panel mb16">
          <div className="pb">
            <div className="grid3" style={{ alignItems: 'center' }}>
              <div style={{ gridColumn: isAdmin ? 'span 2' : 'span 3' }}>
                <div className="gap8 mb8" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">
                    {p.features_done} of {p.features} features done
                    {isAdmin && p.features_submitted > 0 && `, ${p.features_submitted} in review`}
                    {isAdmin && p.features_proposed > 0 && `, ${p.features_proposed} proposed`}
                  </span>
                  {isAdmin && <Health h={p.health} />}
                </div>
                <PlanLine done={p.progress_pct} review={isAdmin ? p.pending_pct : 0} expected={isAdmin ? p.expected_pct : undefined} />
                {isAdmin && (
                  <div className="mt8">
                    <PlanLegend />
                  </div>
                )}
              </div>
              {isAdmin && (
                <dl className="kv">
                  <dt>Runs</dt>
                  <dd>
                    {fmtDateY(p.start_date)} to {fmtDateY(p.end_date)}
                  </dd>
                  <dt>Time</dt>
                  <dd>
                    <DaysLeft n={p.days_left} end={p.end_date} />
                  </dd>
                  {p.target_end_date && (
                    <>
                      <dt>Target</dt>
                      <dd style={{ color: p.end_date > p.target_end_date ? 'var(--red)' : undefined }}>
                        {fmtDateY(p.target_end_date)}
                        {p.end_date > p.target_end_date && ', modules run past it'}
                      </dd>
                    </>
                  )}
                  <dt>People</dt>
                  <dd>{p.people}</dd>
                </dl>
              )}
            </div>
          </div>
        </div>
      )}

      {isAdmin && data.flags?.length > 0 && (
        <div className="panel mb16">
          <div className="ph">
            <h3>Flags on this project</h3>
            <Link to="/flags" className="small">
              All flags
            </Link>
          </div>
          <div className="divide">
            {data.flags.map((f) => (
              <div key={f.id} className={`flag ${f.severity}${f.acknowledged_at ? ' acked' : ''}`}>
                <span className="bar" />
                <div>
                  <div className="t">{f.title}</div>
                  <div className="d">{f.details}</div>
                </div>
                <span className="tiny muted">{fmtWhen(f.raised_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button className={tab === 'modules' ? 'on' : ''} onClick={() => setTab('modules')} role="tab" aria-selected={tab === 'modules'}>
          Modules ({mods.length})
        </button>
        <button className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')} role="tab" aria-selected={tab === 'timeline'}>
          Timeline
        </button>
        {isAdmin && (
          <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')} role="tab" aria-selected={tab === 'activity'}>
            Activity
          </button>
        )}
      </div>

      {tab === 'modules' && (
        <>
          {!mods.length && (
            <div className="panel">
              <Empty title="No modules yet">{isAdmin ? 'Add a module with its features, dates and people to start tracking.' : 'Nothing here is assigned to you yet.'}</Empty>
            </div>
          )}
          {mods.length > 1 && (
            <div className="gap8 mb8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm ghost" onClick={() => setOpenIds(new Set(mods.map((m) => m.id)))}>
                Expand all
              </button>
              <button className="btn sm ghost" onClick={() => setOpenIds(new Set())}>
                Collapse all
              </button>
            </div>
          )}
          {mods.map((m) => (
            <ModuleBlock key={m.id} m={m} admin={isAdmin} me={user} open={opened.has(m.id)} onToggle={() => toggle(m.id)} onAction={onAction} />
          ))}
        </>
      )}
      {tab === 'timeline' && (
        <div className="panel">
          <div className="pb">
            <Timeline modules={mods} />
            <div className="legend mt16">
              <span>
                <i className="k-done" />
                Done
              </span>
              <span>
                <i className="k-tick" />
                Today
              </span>
            </div>
          </div>
        </div>
      )}
      {tab === 'activity' && (
        <div className="panel">
          <div className="pb feed">
            {(activity.data?.activity || []).map((a) => (
              <div key={a.id}>
                <strong>{a.actor || 'System'}</strong> {a.action} {a.entity}
                {a.details && <span className="muted">: {a.details}</span>}
                <div className="tiny faint">{fmtWhen(a.at)}</div>
              </div>
            ))}
            {!activity.data?.activity?.length && <Empty title="No activity yet" />}
          </div>
        </div>
      )}

      {modal?.kind === 'edit-p' && <ProjectForm project={p} onClose={close} onDone={reload} />}
      {modal?.kind === 'add-m' && <ModuleForm projectId={p.id} onClose={close} onDone={reload} />}
      {modal?.kind === 'edit-m' && <ModuleEdit module={modal.item} onClose={close} onDone={reload} />}
      {modal?.kind === 'assign-m' && <AssignModal item={{ ...modal.item, level: 'module' }} onClose={close} onDone={reload} />}
      {modal?.kind === 'assign-f' && <AssignModal item={{ ...modal.item, level: 'feature' }} onClose={close} onDone={reload} />}
      {modal?.kind === 'add-f' && <FeatureForm module={modal.mod} onClose={close} onDone={reload} />}
      {modal?.kind === 'edit-f' && <FeatureForm module={modal.mod} feature={modal.item} onClose={close} onDone={reload} />}
      {modal?.kind === 'propose' && <ProposeModal module={modal.item} onClose={close} onDone={reload} />}
      {modal?.kind === 'hold-m' && (
        <ReasonModal title={`Put ${modal.item.name} on hold`} label="Reason" confirm="Put on hold" action={statusAction(modal.item.id, 'on_hold')} onClose={close} onDone={() => (toast('Module on hold'), reload())} />
      )}
      {modal?.kind === 'cancel-m' && (
        <ReasonModal danger title={`Cancel ${modal.item.name}`} label="Reason" confirm="Cancel module" action={statusAction(modal.item.id, 'cancelled')} onClose={close} onDone={() => (toast('Module cancelled'), reload())} />
      )}
      {modal?.kind === 'resume-m' && (
        <ReasonModal optional title={`Resume ${modal.item.name}`} label="Note" confirm="Resume module" action={statusAction(modal.item.id, 'resume')} onClose={close} onDone={() => (toast('Module resumed'), reload())} />
      )}
    </>
  );
}
