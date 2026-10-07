import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, Loading, ErrorBox, Size, SizePicker, fmtDate, fmtWhen, Empty, Field, useAction, FileLink } from '../../ui.jsx';

const fileSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function ReviewCard({ s, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const decide = async (decision) => {
    const ok = await run(() => api.post(`/submissions/${s.id}/decide`, { decision, reason }), decision === 'approve' ? `${s.feature_name} approved` : `${s.feature_name} sent back`);
    if (ok) onDone();
  };
  return (
    <div className="pb">
      <div className="gap8" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="gap8">
            <Size s={s.size} />
            <Link to={`/items/${s.item_id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {s.feature_name}
            </Link>
            {s.rounds > 1 && <span className="tag">round {s.rounds}</span>}
          </div>
          <div className="tiny muted mt8">
            {s.company_name} / {s.project_name} / {s.module_name}. Planned finish {fmtDate(s.planned_end)}.
          </div>
        </div>
        <span className="small muted">
          {s.submitted_by_name}, {fmtWhen(s.submitted_at)}
        </span>
      </div>
      <div className="quote mt8">{s.note}</div>
      {s.files.length > 0 ? (
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
      ) : (
        <div className="tiny muted mt8">No documents attached.</div>
      )}
      <ErrorBox error={error} />
      {rejecting ? (
        <div className="mt16">
          <Field label="What needs to change?" hint="shown to the person">
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="gap8">
            <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => decide('reject')}>
              Send back
            </button>
            <button className="btn ghost" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gap8 mt16">
          <button className="btn primary" disabled={busy} onClick={() => decide('approve')}>
            Approve
          </button>
          <button className="btn" onClick={() => setRejecting(true)}>
            Send back
          </button>
        </div>
      )}
    </div>
  );
}

function ProposalCard({ p, onDone }) {
  const [size, setSize] = useState(p.size);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const accept = async () => {
    const ok = await run(() => api.post(`/items/${p.id}/accept`, { size }), `${p.name} accepted`);
    if (ok) onDone();
  };
  const decline = async () => {
    const ok = await run(() => api.post(`/items/${p.id}/decline`, { reason }), `${p.name} declined`);
    if (ok) onDone();
  };
  return (
    <div className="pb">
      <div className="gap8" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Link to={`/items/${p.id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>
            {p.name}
          </Link>
          <div className="tiny muted">
            {p.company_name} / {p.project_name} / {p.module_name}, due {fmtDate(p.module_end)}
          </div>
        </div>
        <span className="small muted">
          {p.proposed_by_name}, {fmtWhen(p.created_at)}
        </span>
      </div>
      {p.description && <div className="small mt8">{p.description}</div>}
      <div className="quote mt8">Why: {p.proposal_reason}</div>
      <ErrorBox error={error} />
      {declining ? (
        <div className="mt16">
          <Field label="Why not?" hint="shown to the person">
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="gap8">
            <button className="btn danger" disabled={busy || !reason.trim()} onClick={decline}>
              Decline
            </button>
            <button className="btn ghost" onClick={() => setDeclining(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gap8 mt16">
          <span className="small muted">Size</span>
          <SizePicker value={size} onChange={setSize} />
          <button className="btn primary" disabled={busy} onClick={accept}>
            Accept
          </button>
          <button className="btn" onClick={() => setDeclining(true)}>
            Decline
          </button>
          <span className="tiny muted">Once accepted it counts toward progress, so the module's percentage dips a little.</span>
        </div>
      )}
    </div>
  );
}

export default function Reviews() {
  const { data, loading, error, reload } = useApi('/admin/reviews');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="head">
        <div>
          <h1>Review queue</h1>
          <div className="sub">Only approved work moves the percentages. Proposed features count once you accept them.</div>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="ph">
            <h2>Completed work</h2>
            <span className="small muted">{data.submissions.length} waiting</span>
          </div>
          {!data.submissions.length && <Empty title="Nothing to review">Submitted features appear here with their notes and documents.</Empty>}
          <div className="divide">
            {data.submissions.map((s) => (
              <ReviewCard key={s.id} s={s} onDone={reload} />
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="ph">
            <h2>Proposed features</h2>
            <span className="small muted">{data.proposed.length} waiting</span>
          </div>
          {!data.proposed.length && <Empty title="No proposals">Features the team adds to their modules appear here.</Empty>}
          <div className="divide">
            {data.proposed.map((p) => (
              <ProposalCard key={p.id} p={p} onDone={reload} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
