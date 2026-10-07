import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, Loading, ErrorBox, Avatar, Status, fmtDate, Empty, Modal, Field, useAction } from '../../ui.jsx';

const LOG = { submitted: ['Submitted', 'var(--green)'], draft: ['Draft saved', 'var(--watch)'], none: ['Not started', 'var(--faint)'] };
const BUCKET = { overdue: 'Overdue', sent_back: 'Sent back', due_today: 'Due today', in_window: 'Working on', blocked: 'Blocked', up_next: 'Up next', adhoc: 'Added task' };

function AdhocModal({ person, date, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const ok = await run(() => api.post('/admin/targets', { user_id: person.id, date, title }), `Task added for ${person.name.split(' ')[0]}`);
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={`Add a task for ${person.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !title.trim()} onClick={save}>
            Add task
          </button>
        </>
      }
    >
      <p className="small muted">It appears on their list for {fmtDate(date)}. One-off tasks count in target completion but never in project progress.</p>
      <ErrorBox error={error} />
      <Field label="Task">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Join the 4 PM client call" />
      </Field>
    </Modal>
  );
}

export default function Team() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || '';
  const { data, loading, error, reload } = useApi(`/admin/team${date ? `?date=${date}` : ''}`);
  const [open, setOpen] = useState(new Set());
  const [adhoc, setAdhoc] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const ppl = data.people;
  const submitted = ppl.filter((p) => p.log_status === 'submitted').length;
  const toggle = (id) => {
    const s = new Set(open);
    s.has(id) ? s.delete(id) : s.add(id);
    setOpen(s);
  };
  return (
    <>
      <div className="head">
        <div>
          <h1>Team today</h1>
          <div className="sub">
            {fmtDate(data.date)}. {submitted} of {ppl.length} logs submitted.{!data.is_working_day && ' A day off on the group calendar.'}
          </div>
        </div>
        <div className="actions">
          <input type="date" className="input" style={{ width: 'auto' }} value={data.date} onChange={(e) => setParams(e.target.value ? { date: e.target.value } : {})} aria-label="Day" />
        </div>
      </div>
      <div className="panel scroll-x">
        {!ppl.length ? (
          <Empty title="No team members yet">Add people on the People page, then assign them to modules.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Targets worked</th>
                <th>Daily log</th>
                <th className="r">Hours today</th>
                <th className="r">This week</th>
                <th>Currently on</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {ppl.map((p) => (
                <Fragment key={p.id}>
                  <tr className="click" onClick={() => toggle(p.id)} aria-expanded={open.has(p.id)}>
                    <td>
                      <div className="person">
                        <Avatar name={p.name} />
                        <div>
                          <Link to={`/people/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                            {p.name}
                          </Link>
                          <div className="tiny muted">{p.title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className="num">
                        {p.targets_worked}/{p.targets}
                      </span>
                      {p.overdue_targets > 0 && <span className="tiny" style={{ color: 'var(--red)' }}> {p.overdue_targets} overdue</span>}
                    </td>
                    <td className="nowrap" style={{ color: LOG[p.log_status][1], fontWeight: 600 }}>
                      {LOG[p.log_status][0]}
                    </td>
                    <td className="r num">{p.hours_today || ''}</td>
                    <td className="r num">{p.hours_week || ''}</td>
                    <td className="small">
                      {p.in_progress.slice(0, 3).map((f) => (
                        <div key={f.id}>
                          <Link to={`/items/${f.id}`} onClick={(e) => e.stopPropagation()}>
                            {f.name}
                          </Link>{' '}
                          <span className="muted">{f.project_name}</span> {f.status !== 'in_progress' && <Status s={f.status} />}
                        </div>
                      ))}
                      {p.in_progress.length > 3 && <div className="muted">and {p.in_progress.length - 3} more</div>}
                      {!p.in_progress.length && <span className="faint">Nothing in progress</span>}
                    </td>
                    <td>
                      {p.flags.length ? (
                        <span className={`sev ${p.flags.some((f) => f.severity === 'red') ? 'red' : 'amber'}`} title={p.flags.map((f) => f.title).join('\n')}>
                          {p.flags.length}
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                  {open.has(p.id) && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--raised)' }}>
                        <div className="gap8" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <strong className="small">Target list for {fmtDate(data.date)}</strong>
                            {!p.target_list.length && <div className="small muted">No targets.</div>}
                            {p.target_list.map((t) => (
                              <div key={t.id} className="small mt8">
                                <span className="tag">{BUCKET[t.bucket]}</span>{' '}
                                {t.work_item_id ? (
                                  <>
                                    <Link to={`/items/${t.work_item_id}`}>{t.name}</Link> <span className="muted">{t.project_name}</span>
                                  </>
                                ) : (
                                  t.adhoc_title
                                )}
                              </div>
                            ))}
                            {p.flags.map((f) => (
                              <div key={f.id} className="small mt8">
                                <span className={`sev ${f.severity}`}>Flag</span> {f.title}
                              </div>
                            ))}
                          </div>
                          <div className="gap8">
                            <Link className="btn sm" to={`/people/${p.id}`}>
                              Open profile
                            </Link>
                            <button className="btn sm" onClick={() => setAdhoc(p)}>
                              Add a task
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {adhoc && <AdhocModal person={adhoc} date={data.date} onClose={() => setAdhoc(null)} onDone={reload} />}
    </>
  );
}
