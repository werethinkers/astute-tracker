import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { fmtWhen, Empty, Modal, Field, useAction, ErrorBox } from '../../ui.jsx';

const linkFor = (f) => {
  if (f.entity_type === 'feature' || f.entity_type === 'module') return `/items/${f.entity_id}`;
  if (f.entity_type === 'project') return `/projects/${f.entity_id}`;
  if (f.entity_type === 'user') return `/people/${f.entity_id}`;
  return null;
};
const TYPE = {
  overdue: 'Overdue',
  behind: 'Behind schedule',
  blocked_long: 'Blocked',
  stalled: 'Stalled',
  review_waiting: 'Review waiting',
  missing_logs: 'Missing logs',
  overload: 'Overloaded',
  scope_growth: 'Scope growth',
  unassigned: 'Unassigned',
};

function AckModal({ flag, onClose, onDone }) {
  const [note, setNote] = useState(flag.ack_note || '');
  const { busy, error, run } = useAction();
  const save = async () => {
    const ok = await run(() => api.post(`/admin/flags/${flag.id}/ack`, { note }), 'Flag acknowledged');
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title="Acknowledge flag"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !note.trim()} onClick={save}>
            Acknowledge
          </button>
        </>
      }
    >
      <p className="small muted">The flag stays until its cause is fixed, but moves below the ones nobody has looked at.</p>
      <div className="quote mb16">{flag.title}</div>
      <ErrorBox error={error} />
      <Field label="What is the situation?" hint="e.g. client delayed inputs, extension agreed">
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

export default function FlagList({ flags, onChange, compact, cleared }) {
  const [ack, setAck] = useState(null);
  if (!flags.length)
    return (
      <Empty title={cleared ? 'No cleared flags yet' : 'Nothing is lagging'}>
        {cleared ? 'Flags move here once their cause is fixed.' : 'Overdue, stalled, blocked and slipping work shows up here as soon as it happens.'}
      </Empty>
    );
  return (
    <>
      <div className="divide">
        {flags.map((f) => {
          const to = linkFor(f);
          return (
            <div key={f.id} className={`flag ${f.severity}${f.acknowledged_at && !cleared ? ' acked' : ''}`}>
              <span className="bar" />
              <div style={{ minWidth: 0 }}>
                <div className="gap8">
                  <span className={`sev ${f.severity}`}>{TYPE[f.flag_type] || f.flag_type}</span>
                  {to ? (
                    <Link to={to} className="t" style={{ textDecoration: 'none' }}>
                      {f.title}
                    </Link>
                  ) : (
                    <span className="t">{f.title}</span>
                  )}
                </div>
                {!compact && <div className="d">{f.details}</div>}
                {f.ack_note && (
                  <div className="ack">
                    {f.ack_name}: {f.ack_note}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tiny muted nowrap">{cleared ? `cleared ${fmtWhen(f.cleared_at)}` : `since ${fmtWhen(f.raised_at)}`}</div>
                {!cleared && (
                  <button className="btn sm ghost mt8" onClick={() => setAck(f)}>
                    {f.acknowledged_at ? 'Edit note' : 'Acknowledge'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {ack && <AckModal flag={ack} onClose={() => setAck(null)} onDone={onChange} />}
    </>
  );
}
