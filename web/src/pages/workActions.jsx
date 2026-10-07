import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Field, useAction, ErrorBox } from '../ui.jsx';

/** "Mark as done" form: compulsory note plus documents and links, sent for admin review. */
export function SubmitModal({ feature, minChars = 30, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState([]);
  const { busy, error, run } = useAction();
  const linkList = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const short = note.trim().length < minChars;
  const needsProof = feature.requires_proof && !files.length && !linkList.length;
  const send = async () => {
    const fd = new FormData();
    fd.append('note', note);
    fd.append('links', JSON.stringify(linkList));
    for (const f of files) fd.append('files', f);
    const out = await run(() => api.post(`/items/${feature.id}/submit`, fd), 'Sent for review');
    if (out) {
      onDone?.(out);
      onClose();
    }
  };
  return (
    <Modal
      title={`Mark "${feature.name}" as done`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || short || needsProof} onClick={send}>
            {busy ? 'Sending…' : 'Send for review'}
          </button>
        </>
      }
    >
      <p className="small muted">An admin reviews your note and files. The percentage moves once it is approved.</p>
      <ErrorBox error={error} />
      <Field label="What did you do?" hint={`required, at least ${minChars} characters`}>
        <textarea className="input" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was built or changed, how you checked it, anything the reviewer should know." autoFocus />
        <span className="tiny" style={{ color: short ? 'var(--watch)' : 'var(--green)' }}>
          {note.trim().length} / {minChars}
        </span>
      </Field>
      <Field label="Documents" hint={feature.requires_proof ? 'this feature needs a document or a link' : 'optional, up to 10 files of 25 MB'}>
        <input className="input" type="file" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 10))} />
      </Field>
      <Field label="Links" hint="Drive, GitHub, Figma… one per line">
        <textarea className="input" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://" />
      </Field>
      {needsProof && <div className="note">Attach a document or add a link to send this for review.</div>}
    </Modal>
  );
}

export function BlockModal({ feature, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const send = async () => {
    const ok = await run(() => api.post(`/items/${feature.id}/status`, { status: 'blocked', reason }), 'Marked as blocked');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal
      title={`What is "${feature.name}" waiting on?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !reason.trim()} onClick={send}>
            Mark as blocked
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <Field label="Waiting on" hint="a person, a decision, a file…">
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

export function ProposeModal({ module, onClose, onDone }) {
  const [f, setF] = useState({ name: '', description: '', size: 'medium', reason: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const send = async () => {
    const ok = await run(() => api.post(`/items/${module.id}/propose`, f), 'Feature proposed. An admin will review it.');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal
      title={`Add a feature to ${module.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.name.trim() || !f.reason.trim()} onClick={send}>
            Propose feature
          </button>
        </>
      }
    >
      <p className="small muted">You can start on it right away. It counts toward progress once an admin accepts it and confirms the size.</p>
      <ErrorBox error={error} />
      <Field label="Feature name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
      </Field>
      <Field label="What it covers" hint="optional">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <Field group label="Suggested size">
        <SizeSeg value={f.size} onChange={(v) => setF({ ...f, size: v })} />
      </Field>
      <Field label="Why it is needed">
        <textarea className="input" rows={2} value={f.reason} onChange={set('reason')} />
      </Field>
    </Modal>
  );
}

function SizeSeg({ value, onChange }) {
  return (
    <div className="seg">
      {['small', 'medium', 'large'].map((s) => (
        <button type="button" key={s} className={value === s ? 'on' : ''} onClick={() => onChange(s)}>
          {s[0].toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}
