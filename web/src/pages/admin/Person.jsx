import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Avatar, Status, Size, fmtDate, fmtWhen, Empty } from '../../ui.jsx';
import FlagList from './FlagList.jsx';

function Stat({ n, label, unit = '', bad }) {
  return (
    <div className="counter" style={{ cursor: 'default' }}>
      <div className="n" style={{ color: bad ? 'var(--red)' : undefined }}>
        {n == null ? '—' : `${n}${unit}`}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}

export default function Person() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi(`/admin/people/${id}`);
  const [tab, setTab] = useState('work');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { person: u, features, logs, entries, submissions, hours_by_project: hbp, flags, stats } = data;
  const open = features.filter((f) => !['done', 'cancelled'].includes(f.status));
  const done = features.filter((f) => f.status === 'done');
  const maxH = Math.max(1, ...hbp.map((h) => h.hours));
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const logByDate = new Map(logs.map((l) => [l.date, l]));
  return (
    <>
      <div className="head">
        <div className="person">
          <Avatar name={u.name} lg />
          <div>
            <div className="crumbs">
              <Link to="/team">Team today</Link>
            </div>
            <h1>{u.name}</h1>
            <div className="sub">
              {u.title || (u.role === 'admin' ? 'Admin' : 'Team member')}, {u.email}
              {!u.active && ', deactivated'}. Last sign-in {u.last_login_at ? fmtWhen(u.last_login_at) : 'never'}.
            </div>
          </div>
        </div>
      </div>

      <div className="counters" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <Stat n={stats.open_features} label="Open features" />
        <Stat n={stats.late_features} label="Past their planned finish" bad={stats.late_features > 0} />
        <Stat n={stats.target_completion} unit="%" label={`Targets worked on, last ${stats.days_measured} working days`} />
        <Stat n={stats.log_compliance} unit="%" label="Days with a submitted log" bad={stats.log_compliance != null && stats.log_compliance < 70} />
      </div>

      {flags.length > 0 && (
        <div className="panel mb16">
          <div className="ph">
            <h3>Flags</h3>
          </div>
          <FlagList flags={flags} onChange={reload} />
        </div>
      )}

      <div className="tabs">
        {[
          ['work', `Assigned work (${open.length})`],
          ['logs', 'Daily logs'],
          ['subs', 'Completion notes'],
          ['hours', 'Hours'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'work' && (
        <div className="panel scroll-x">
          {!features.length ? (
            <Empty title="No assignments">Assign this person to a module or feature from a project page.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Planned finish</th>
                  <th>Last logged</th>
                </tr>
              </thead>
              <tbody>
                {[...open, ...done].map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="gap8">
                        <Size s={f.size} />
                        <Link to={`/items/${f.id}`} style={{ fontWeight: 600 }}>
                          {f.name}
                        </Link>
                      </div>
                      <div className="tiny muted" style={{ marginLeft: 30 }}>
                        {f.module_name}
                      </div>
                    </td>
                    <td className="small">
                      <Link to={`/projects/${f.project_id}`}>{f.project_name}</Link>
                      <div className="tiny muted">{f.company_name}</div>
                    </td>
                    <td>
                      <Status s={f.status} />
                    </td>
                    <td className="nowrap small" style={{ color: f.late ? 'var(--red)' : undefined, fontWeight: f.late ? 600 : undefined }}>
                      {fmtDate(f.planned_end)}
                    </td>
                    <td className="nowrap small muted">{f.last_log ? fmtDate(f.last_log) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="panel">
          {!byDate.size && <Empty title="No logs in the last three weeks" />}
          <div className="divide">
            {[...byDate.entries()].map(([d, es]) => {
              const l = logByDate.get(d);
              return (
                <div key={d} className="pb">
                  <div className="gap8" style={{ justifyContent: 'space-between' }}>
                    <strong>{fmtDate(d)}</strong>
                    <span className="small muted">
                      {es.reduce((s, e) => s + e.hours, 0)} h, {l?.submitted_at ? 'submitted' : 'draft'}
                    </span>
                  </div>
                  {es.map((e) => (
                    <div key={e.id} className="small mt8" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                      <span>
                        <span className="muted">{e.feature_name ? `${e.feature_name} (${e.project_name})` : e.category || 'Other'}:</span> {e.work_done}
                      </span>
                      <span className="num">{e.hours} h</span>
                    </div>
                  ))}
                  {l?.blockers && <div className="small mt8" style={{ color: 'var(--red)' }}>Blockers: {l.blockers}</div>}
                  {l?.tomorrow_plan && <div className="small muted mt8">Tomorrow: {l.tomorrow_plan}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'subs' && (
        <div className="panel">
          {!submissions.length && <Empty title="Nothing submitted yet" />}
          <div className="divide">
            {submissions.map((s) => (
              <div key={s.id} className="pb">
                <div className="gap8" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <Link to={`/items/${s.item_id}`} style={{ fontWeight: 600 }}>
                      {s.feature_name}
                    </Link>{' '}
                    <span className="small muted">
                      {s.project_name}, {fmtWhen(s.submitted_at)}
                    </span>
                  </span>
                  {s.decision === 'approved' ? <span className="pill done">Approved</span> : s.decision === 'rejected' ? <span className="pill sentback">Sent back</span> : <span className="pill submitted">Waiting</span>}
                </div>
                <div className="quote mt8">{s.note}</div>
                {s.reason && <div className="small mt8 muted">Admin's note: {s.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'hours' && (
        <div className="panel">
          <div className="ph">
            <h3>Hours by project, last 30 days</h3>
          </div>
          <div className="pb">
            {!hbp.length && <Empty title="No hours logged" />}
            {hbp.map((h) => (
              <div key={h.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr 60px', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                <span className="small">{h.label}</span>
                <div className="plan">
                  <div className="done" style={{ width: `${(h.hours / maxH) * 100}%` }} />
                </div>
                <span className="num r">{h.hours} h</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
