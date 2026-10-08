import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Status, Size, Avatar, PlanLine, Health, DaysLeft, fmtDate, fmtDateY, fmtWhen, Empty, useAction, useToast, Field, FileLink, Modal } from '../ui.jsx';
import { SubmitModal, BlockModal, ProgressModal } from './workActions.jsx';
import { FeatureForm, ModuleEdit, AssignModal, ReasonModal } from './adminForms.jsx';

const fileSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Submission({ s, admin, pending, onDecided }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const decide = async (decision) => {
    const ok = await run(() => api.post(`/submissions/${s.id}/decide`, { decision, reason }), decision === 'approve' ? 'Approved' : 'Sent back');
    if (ok) onDecided();
  };
  return (
    <div className="pb">
      <div className="gap8" style={{ justifyContent: 'space-between' }}>
        <span>
          <strong>{s.submitted_by_name}</strong> <span className="muted small">submitted {fmtWhen(s.submitted_at)}</span>
        </span>
        {s.decision === 'approved' && <span className="pill done">Approved by {s.decided_by_name}</span>}
        {s.decision === 'rejected' && <span className="pill sentback">Sent back by {s.decided_by_name}</span>}
        {!s.decision && <span className="pill submitted">Waiting for review</span>}
      </div>
      <div className="quote mt8">{s.note}</div>
      {s.files.length > 0 && (
        <div className="files">
          {s.files.map((f) =>
            f.kind === 'file' ? (
              <FileLink key={f.id} file={f}>
                {f.file_name} <span className="faint">{fileSize(f.size_bytes)}</span>
              </FileLink>
            ) : (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer noopener">
                {f.url.replace(/^https?:\/\//, '').slice(0, 48)}
              </a>
            )
          )}
        </div>
      )}
      {s.reason && <div className="small mt8" style={{ color: s.decision === 'rejected' ? 'var(--red)' : undefined }}>Admin's note: {s.reason}</div>}
      {admin && pending && (
        <div className="mt16">
          <ErrorBox error={error} />
          {mode === 'reject' ? (
            <>
              <Field label="What needs to change?">
                <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
              <div className="gap8">
                <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => decide('reject')}>
                  Send back
                </button>
                <button className="btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="gap8">
              <button className="btn primary" disabled={busy} onClick={() => decide('approve')}>
                Approve
              </button>
              <button className="btn" onClick={() => setMode('reject')}>
                Send back
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Comments({ itemId, comments, onPosted }) {
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();
  const post = async () => {
    const ok = await run(() => api.post(`/items/${itemId}/comments`, { body }));
    if (ok) {
      setBody('');
      onPosted();
    }
  };
  return (
    <div className="panel">
      <div className="ph">
        <h3>Discussion</h3>
      </div>
      <div className="pb">
        {comments.map((c) => (
          <div key={c.id} className="person mb16" style={{ alignItems: 'flex-start' }}>
            <Avatar name={c.name} />
            <div>
              <div className="small">
                <strong>{c.name}</strong> <span className="faint">{fmtWhen(c.created_at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          </div>
        ))}
        <ErrorBox error={error} />
        <textarea className="input" rows={2} placeholder="Ask a question or leave a note for the team" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Comment" />
        <button className="btn sm mt8" disabled={busy || !body.trim()} onClick={post}>
          Post comment
        </button>
      </div>
    </div>
  );
}

export default function Item() {
  const { id } = useParams();
  const { isAdmin, user: me } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/items/${id}`);
  const [modal, setModal] = useState(null);
  const [finishNote, setFinishNote] = useState('');
  const { run } = useAction();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { item: it, project, module, assignees, submissions, logs, comments, features, can_work, facts, flags } = data;
  const isFeature = it.level === 'feature';
  const pending = submissions.find((s) => !s.decision);
  const close = () => setModal(null);
  const status = (s) => (reason) => api.post(`/items/${it.id}/status`, { status: s, reason });
  const hours = logs.reduce((s, l) => s + l.hours, 0);
  const worker = can_work && (!isAdmin || assignees.some((a) => a.id === me.id));

  return (
    <>
      <div className="head">
        <div>
          <div className="crumbs">
            <Link to={`/projects/${project.id}`}>{project.name}</Link>
            {module && (
              <>
                {' / '}
                <Link to={`/items/${module.id}`}>{module.name}</Link>
              </>
            )}
          </div>
          <div className="gap8">
            <Size s={it.size} />
            <h1>{it.name}</h1>
          </div>
          <div className="gap8 mt8">
            <Status s={it.status} sentBack={it.sent_back} />
            <span className="tag">{isFeature ? 'Feature' : 'Module'}</span>
            {it.origin === 'workforce' && <span className="tag">Added by {it.proposed_by}</span>}
            {it.requires_proof && <span className="tag">Needs proof</span>}
            {isAdmin && facts && <Health h={facts.health} />}
          </div>
        </div>
        <div className="actions">
          {isFeature && worker && ['not_started', 'in_progress', 'blocked'].includes(it.status) && (
            <button className="btn" onClick={() => setModal('progress')}>
              Update progress
            </button>
          )}
          {isFeature && worker && ['not_started', 'in_progress', 'blocked'].includes(it.status) && (
            <button className="btn primary" onClick={() => setModal('submit')}>
              Mark as done
            </button>
          )}
          {isFeature && worker && ['not_started', 'in_progress'].includes(it.status) && (
            <button className="btn" onClick={() => setModal('block')}>
              I'm blocked
            </button>
          )}
          {isFeature && worker && it.status === 'blocked' && (
            <button className="btn" onClick={() => run(() => api.post(`/items/${it.id}/status`, { status: 'in_progress' }), 'Unblocked').then(reload)}>
              No longer blocked
            </button>
          )}
          {isAdmin && (
            <>
              <button className="btn" onClick={() => setModal('assign')}>
                Assign
              </button>
              <button className="btn" onClick={() => setModal('edit')}>
                Edit
              </button>
              <button className="btn danger" onClick={() => setModal('delete')}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {it.status === 'proposed' && (
        <div className="note">
          Proposed by {it.proposed_by}: {it.proposal_reason} {isAdmin ? <Link to="/reviews">Accept or decline it in the review queue.</Link> : 'It counts toward progress once an admin accepts it.'}
        </div>
      )}
      {it.status === 'blocked' && it.status_reason && <div className="err">Blocked. Waiting on: {it.status_reason}</div>}
      {['on_hold', 'cancelled'].includes(it.status) && it.status_reason && <div className="note">Reason: {it.status_reason}</div>}
      {isAdmin && flags?.length > 0 && (
        <div className="panel mb16">
          <div className="divide">
            {flags.map((f) => (
              <div key={f.id} className={`flag ${f.severity}`}>
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

      <div className="grid2">
        <div className="stack">
          {it.description && (
            <div className="panel">
              <div className="pb" style={{ whiteSpace: 'pre-wrap' }}>
                {it.description}
              </div>
            </div>
          )}

          {!isFeature && features && (
            <div className="panel">
              <div className="ph">
                <h3>Features</h3>
                {it.progress_pct != null && (
                  <div style={{ width: 220 }}>
                    <PlanLine done={it.progress_pct} />
                  </div>
                )}
              </div>
              <div className="divide">
                {features.map((f) => (
                  <div key={f.id} className="pb gap8" style={{ justifyContent: 'space-between' }}>
                    <span className="gap8">
                      <Size s={f.size} />
                      <Link to={`/items/${f.id}`}>{f.name}</Link>
                    </span>
                    <span className="gap8">
                      <span className="small muted">{fmtDate(f.planned_end)}</span>
                      <Status s={f.status} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isFeature && (
            <div className="panel">
              <div className="ph">
                <h3>Progress</h3>
                <span className="small muted">{it.status === 'done' ? 100 : it.work_pct || 0}% of the work</span>
              </div>
              <div className="pb">
                <PlanLine done={it.status === 'done' ? 100 : it.work_pct || 0} showPct={false} />
              </div>
              {!data.progress_updates?.length && <div className="pb small muted">No updates yet. {worker ? 'Use Update progress to add one with a note.' : ''}</div>}
              <div className="divide">
                {(data.progress_updates || []).map((u) => (
                  <div key={u.id} className="pb">
                    <div className="gap8 small" style={{ justifyContent: 'space-between' }}>
                      <span>
                        <strong>{u.name}</strong> <span className="muted">{fmtWhen(u.at)}</span>
                      </span>
                      <span className="num">
                        {u.from_pct}% to {u.to_pct}%
                      </span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{u.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isFeature && (
            <div className="panel">
              <div className="ph">
                <h3>Completion history</h3>
                <span className="small muted">
                  {submissions.length} submission{submissions.length === 1 ? '' : 's'}
                </span>
              </div>
              {!submissions.length && <Empty title="Not submitted yet">When the work is finished, use Mark as done to send a note and documents for review.</Empty>}
              <div className="divide">
                {submissions.map((s) => (
                  <Submission key={s.id} s={s} admin={isAdmin} pending={pending?.id === s.id} onDecided={reload} />
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="ph">
              <h3>Work logged</h3>
              <span className="small muted">{hours} hours in total</span>
            </div>
            {!logs.length && <Empty title="No work logged yet">Daily log lines for this {it.level} appear here.</Empty>}
            <div className="divide">
              {logs.map((l) => (
                <div key={l.id} className="pb">
                  <div className="gap8 small" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <strong>{l.name}</strong> <span className="muted">{fmtDate(l.date)}</span>
                    </span>
                    <span className="num">{l.hours} h</span>
                  </div>
                  <div>{l.work_done}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="pb">
              <dl className="kv">
                {isFeature ? (
                  <>
                    <dt>Planned</dt>
                    <dd>
                      {fmtDate(it.planned_start)} to {fmtDate(it.planned_end)}
                      {it.manual_dates && <span className="tiny muted"> (set by hand)</span>}
                    </dd>
                    <dt>Module due</dt>
                    <dd>{fmtDateY(module?.end_date)}</dd>
                  </>
                ) : (
                  <>
                    <dt>Runs</dt>
                    <dd>
                      {fmtDate(it.start_date)} to {fmtDateY(it.end_date)}
                    </dd>
                    <dt>Duration</dt>
                    <dd>{it.duration_days} working days</dd>
                    {it.original_end_date && it.original_end_date !== it.end_date && (
                      <>
                        <dt>Original deadline</dt>
                        <dd>{fmtDateY(it.original_end_date)}</dd>
                      </>
                    )}
                  </>
                )}
                {isAdmin && facts && (
                  <>
                    <dt>Time</dt>
                    <dd>
                      <DaysLeft n={facts.days_left} end={facts.end_date} />
                    </dd>
                  </>
                )}
                <dt>Size</dt>
                <dd>
                  {it.size[0].toUpperCase() + it.size.slice(1)} (weight {it.weight})
                </dd>
                <dt>Venture</dt>
                <dd>{project.company_name}</dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <h3>People</h3>
            </div>
            <div className="pb">
              {assignees.map((a) => (
                <div key={a.id} className="person mb8">
                  <Avatar name={a.name} />
                  <span>
                    {isAdmin ? <Link to={`/people/${a.id}`}>{a.name}</Link> : a.name}
                    {a.is_lead ? <span className="tiny muted"> lead</span> : null}
                  </span>
                </div>
              ))}
              {!assignees.length && <div className="small muted">{isFeature ? 'No one assigned directly; the module team owns it.' : 'Nobody assigned yet.'}</div>}
              {isAdmin && data.effective?.length > 0 && !assignees.length && <div className="small mt8">Owned by: {data.effective.map((u) => u.name).join(', ')}</div>}
            </div>
          </div>

          {isAdmin && isFeature && (
            <div className="panel">
              <div className="ph">
                <h3>Admin actions</h3>
              </div>
              <div className="pb gap8">
                {!['on_hold', 'cancelled', 'done', 'proposed'].includes(it.status) && (
                  <button className="btn sm" onClick={() => setModal('hold')}>
                    Put on hold
                  </button>
                )}
                {['on_hold', 'cancelled'].includes(it.status) && (
                  <button className="btn sm" onClick={() => run(() => api.post(`/items/${it.id}/status`, { status: 'resume' }), 'Resumed').then(reload)}>
                    Resume
                  </button>
                )}
                {it.status === 'done' && (
                  <button className="btn sm" onClick={() => setModal('reopen')}>
                    Reopen
                  </button>
                )}
                {!['cancelled', 'proposed'].includes(it.status) && (
                  <button className="btn sm danger" onClick={() => setModal('cancel')}>
                    Cancel feature
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt16">
        <Comments itemId={it.id} comments={comments} onPosted={reload} />
      </div>

      {modal === 'progress' && (
        <ProgressModal
          feature={it}
          onClose={close}
          onDone={reload}
          onFinish={(n) => {
            setFinishNote(n);
            setModal('submit');
          }}
        />
      )}
      {modal === 'delete' && <DeleteModal item={it} onClose={close} />}
      {modal === 'submit' && <SubmitModal feature={it} minChars={data.min_note_chars} initialNote={finishNote} onClose={close} onDone={reload} />}
      {modal === 'block' && <BlockModal feature={it} onClose={close} onDone={reload} />}
      {modal === 'assign' && <AssignModal item={{ ...it, assignees }} onClose={close} onDone={reload} />}
      {modal === 'edit' && (isFeature ? <FeatureForm module={module} feature={it} onClose={close} onDone={reload} /> : <ModuleEdit module={it} onClose={close} onDone={reload} />)}
      {modal === 'hold' && <ReasonModal title={`Put ${it.name} on hold`} label="Reason" confirm="Put on hold" action={status('on_hold')} onClose={close} onDone={() => (toast('On hold'), reload())} />}
      {modal === 'cancel' && <ReasonModal danger title={`Cancel ${it.name}`} label="Reason" confirm="Cancel feature" action={status('cancelled')} onClose={close} onDone={() => (toast('Cancelled'), reload())} />}
      {modal === 'reopen' && <ReasonModal title={`Reopen ${it.name}`} label="Why it needs more work" confirm="Reopen" action={status('in_progress')} onClose={close} onDone={() => (toast('Reopened'), reload())} />}
    </>
  );
}

function DeleteModal({ item, onClose }) {
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  const go = async () => {
    const out = await run(() => api.del(`/items/${item.id}`), `${item.level === 'module' ? 'Module' : 'Feature'} deleted`);
    if (out) {
      onClose();
      nav(`/projects/${out.project_id}`);
    }
  };
  return (
    <Modal
      title={`Delete ${item.level} "${item.name}"?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep it
          </button>
          <button className="btn danger" disabled={busy} onClick={go}>
            {busy ? 'Deleting…' : 'Delete for good'}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p>
        {item.level === 'module'
          ? 'This removes the module and all of its features, with their notes, progress history, submissions and comments.'
          : 'This removes the feature with its notes, progress history, submissions and comments.'}{' '}
        It cannot be undone. People assigned to it are told. To keep the record, cancel it instead.
      </p>
    </Modal>
  );
}
