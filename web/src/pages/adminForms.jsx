import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Field, useAction, ErrorBox, SizePicker, useApi, Avatar } from '../ui.jsx';

const Footer = ({ onClose, busy, label, disabled, onSave, danger }) => (
  <>
    <button className="btn" onClick={onClose}>
      Cancel
    </button>
    <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || disabled} onClick={onSave}>
      {busy ? 'Saving…' : label}
    </button>
  </>
);

export function ProjectForm({ project, onClose, onDone }) {
  const companies = useApi('/companies');
  const [f, setF] = useState({
    company_id: project?.company_id || '',
    name: project?.name || '',
    description: project?.description || '',
    target_end_date: project?.target_end_date || '',
    show_progress_to_workforce: project ? project.show_progress_to_workforce : true,
    auto_approve: project ? project.auto_approve : false,
    status: project?.status || 'active',
  });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const body = { ...f, target_end_date: f.target_end_date || null };
    const out = await run(() => (project ? api.patch(`/projects/${project.id}`, body) : api.post('/projects', body)), project ? 'Project saved' : 'Project created');
    if (out) {
      onDone?.(out);
      onClose();
    }
  };
  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label={project ? 'Save project' : 'Create project'} disabled={!f.name.trim() || !f.company_id} />}>
      <ErrorBox error={error} />
      <Field label="Venture">
        <select className="input" value={f.company_id} onChange={set('company_id')}>
          <option value="">Choose a venture</option>
          {companies.data?.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Project name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
      </Field>
      <Field label="Description" hint="optional">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <div className="row">
        <Field label="Target end date" hint="optional; warns if modules run past it">
          <input className="input" type="date" value={f.target_end_date} onChange={set('target_end_date')} />
        </Field>
        {project && (
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={f.show_progress_to_workforce} onChange={set('show_progress_to_workforce')} />
        <span>
          Show the overall project percentage to the team
          <div className="tiny muted">Turn off when some modules should stay hidden; the total lets people infer how much else exists.</div>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={f.auto_approve} onChange={set('auto_approve')} />
        <span>
          Approve completed features automatically
          <div className="tiny muted">Skips admin review. Notes and documents are still required.</div>
        </span>
      </label>
    </Modal>
  );
}

function PeoplePicker({ value, lead, onChange, onLead }) {
  const users = useApi('/users');
  const list = (users.data?.users || []).filter((u) => u.active);
  return (
    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 4 }}>
      {list.map((u) => {
        const on = value.includes(u.id);
        return (
          <div key={u.id} className="gap8" style={{ padding: '7px 10px', borderTop: '1px solid var(--line)' }}>
            <label className="gap8" style={{ flex: 1, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])} style={{ accentColor: '#000' }} />
              <Avatar name={u.name} />
              <span>
                {u.name}
                <span className="tiny muted"> {u.title || (u.role === 'admin' ? 'Admin' : '')}</span>
              </span>
            </label>
            {on && value.length > 1 && (
              <label className="tiny gap8" style={{ cursor: 'pointer' }}>
                <input type="radio" name="lead" checked={lead === u.id} onChange={() => onLead(u.id)} style={{ accentColor: '#000' }} />
                Lead
              </label>
            )}
          </div>
        );
      })}
      {!list.length && <div className="pb small muted">Add people on the People page first.</div>}
    </div>
  );
}

export function ModuleForm({ projectId, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ name: '', description: '', size: 'medium', start_date: today, duration_days: 5 });
  const [features, setFeatures] = useState([{ name: '', size: 'medium', requires_proof: false }]);
  const [people, setPeople] = useState([]);
  const [lead, setLead] = useState(null);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const named = features.filter((x) => x.name.trim());
  const save = async () => {
    const out = await run(
      () => api.post(`/projects/${projectId}/modules`, { ...f, duration_days: Number(f.duration_days), features: named, assignee_ids: people, lead_id: lead || people[0] }),
      'Module added'
    );
    if (out) {
      onDone?.(out);
      onClose();
    }
  };
  const setFeat = (i, k, v) => setFeatures(features.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal wide title="New module" onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label="Add module" disabled={!f.name.trim() || !named.length || !f.start_date || !f.duration_days} />}>
      <ErrorBox error={error} />
      <div className="row">
        <Field label="Module name">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
        </Field>
        <Field group label="Size" hint="sets its share of the project">
          <SizePicker value={f.size} onChange={(v) => setF({ ...f, size: v })} />
        </Field>
      </div>
      <Field label="Description" hint="optional">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <div className="row">
        <Field label="Starts on">
          <input className="input" type="date" value={f.start_date} onChange={set('start_date')} />
        </Field>
        <Field label="Duration" hint="working days; the end date skips days off and holidays">
          <input className="input" type="number" min={1} max={730} value={f.duration_days} onChange={set('duration_days')} />
        </Field>
      </div>
      <Field group label="Features" hint="required: everything this module contains. Size sets each feature's share of the module.">
        <div>
          {features.map((x, i) => (
            <div key={i} className="gap8" style={{ marginBottom: 8 }}>
              <input className="input" style={{ flex: '1 1 240px' }} placeholder={`Feature ${i + 1}`} value={x.name} onChange={(e) => setFeat(i, 'name', e.target.value)} aria-label={`Feature ${i + 1} name`} />
              <SizePicker value={x.size} onChange={(v) => setFeat(i, 'size', v)} />
              <label className="tiny gap8" title="Cannot be submitted without a document or link">
                <input type="checkbox" checked={x.requires_proof} onChange={(e) => setFeat(i, 'requires_proof', e.target.checked)} style={{ accentColor: '#000' }} />
                Needs proof
              </label>
              {features.length > 1 && (
                <button type="button" className="btn ghost sm" onClick={() => setFeatures(features.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setFeatures([...features, { name: '', size: 'medium', requires_proof: false }])}>
            Add another feature
          </button>
        </div>
      </Field>
      <Field group label="Assign people" hint="optional; they see every feature in this module">
        <PeoplePicker value={people} lead={lead} onChange={setPeople} onLead={setLead} />
      </Field>
    </Modal>
  );
}

export function ModuleEdit({ module, onClose, onDone }) {
  const [f, setF] = useState({ name: module.name, description: module.description || '', size: module.size, start_date: module.start_date, duration_days: module.duration_days, reason: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const scheduleChanged = f.start_date !== module.start_date || Number(f.duration_days) !== module.duration_days;
  const save = async () => {
    const ok = await run(() => api.patch(`/items/${module.id}`, { ...f, duration_days: Number(f.duration_days) }), 'Module saved');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal title="Edit module" onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label="Save module" disabled={!f.name.trim() || (scheduleChanged && !f.reason.trim())} />}>
      <ErrorBox error={error} />
      <Field label="Module name">
        <input className="input" value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Description">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <Field group label="Size">
        <SizePicker value={f.size} onChange={(v) => setF({ ...f, size: v })} />
      </Field>
      <div className="row">
        <Field label="Starts on">
          <input className="input" type="date" value={f.start_date || ''} onChange={set('start_date')} />
        </Field>
        <Field label="Duration" hint="working days">
          <input className="input" type="number" min={1} value={f.duration_days || ''} onChange={set('duration_days')} />
        </Field>
      </div>
      {scheduleChanged && (
        <Field label="Why the schedule is changing" hint="required; kept in the history, and the original deadline stays on record">
          <input className="input" value={f.reason} onChange={set('reason')} />
        </Field>
      )}
    </Modal>
  );
}

export function FeatureForm({ module, feature, onClose, onDone }) {
  const [f, setF] = useState({
    name: feature?.name || '',
    description: feature?.description || '',
    size: feature?.size || 'medium',
    requires_proof: feature?.requires_proof || false,
    planned_start: feature?.planned_start || '',
    planned_end: feature?.planned_end || '',
    manual: !!feature?.manual_dates,
  });
  const [people, setPeople] = useState([]);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const body = { name: f.name, description: f.description, size: f.size, requires_proof: f.requires_proof };
    if (feature) {
      if (f.manual) Object.assign(body, { planned_start: f.planned_start, planned_end: f.planned_end });
      else if (feature.manual_dates) body.manual_dates = false;
    } else if (people.length) body.assignee_ids = people;
    const ok = await run(() => (feature ? api.patch(`/items/${feature.id}`, body) : api.post(`/items/${module.id}/features`, body)), feature ? 'Feature saved' : 'Feature added');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal title={feature ? 'Edit feature' : `Add a feature to ${module.name}`} onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label={feature ? 'Save feature' : 'Add feature'} disabled={!f.name.trim()} />}>
      <ErrorBox error={error} />
      <Field label="Feature name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
      </Field>
      <Field label="Description" hint="optional">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <Field group label="Size" hint="its share of the module">
        <SizePicker value={f.size} onChange={(v) => setF({ ...f, size: v })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={f.requires_proof} onChange={set('requires_proof')} />
        <span>Needs proof: cannot be submitted without a document or link</span>
      </label>
      {feature && (
        <>
          <label className="check">
            <input type="checkbox" checked={f.manual} onChange={set('manual')} />
            <span>
              Set this feature's dates by hand
              <div className="tiny muted">Otherwise the system plans them inside the module window by size.</div>
            </span>
          </label>
          {f.manual && (
            <div className="row">
              <Field label="Planned start">
                <input className="input" type="date" value={f.planned_start} onChange={set('planned_start')} />
              </Field>
              <Field label="Planned finish">
                <input className="input" type="date" value={f.planned_end} onChange={set('planned_end')} />
              </Field>
            </div>
          )}
        </>
      )}
      {!feature && (
        <Field group label="Assign to specific people" hint="optional; otherwise the module's team owns it">
          <PeoplePicker value={people} lead={null} onChange={setPeople} onLead={() => {}} />
        </Field>
      )}
    </Modal>
  );
}

export function AssignModal({ item, onClose, onDone }) {
  const [people, setPeople] = useState((item.assignees || []).map((a) => a.id));
  const [lead, setLead] = useState((item.assignees || []).find((a) => a.is_lead)?.id || null);
  const { busy, error, run } = useAction();
  const save = async () => {
    const ok = await run(() => api.post(`/items/${item.id}/assignees`, { user_ids: people, lead_id: lead || people[0] }), 'Assignment saved');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal title={`Who works on ${item.name}?`} onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label="Save assignment" />}>
      <p className="small muted">
        {item.level === 'module'
          ? 'Module assignees see every feature in it and own any feature without its own assignee.'
          : 'Feature assignees see only this feature and its module name. Leave empty to give it back to the module team.'}
      </p>
      <ErrorBox error={error} />
      <PeoplePicker value={people} lead={lead} onChange={setPeople} onLead={setLead} />
    </Modal>
  );
}

export function ReasonModal({ title, label, action, onClose, onDone, danger, confirm = 'Confirm', optional }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const ok = await run(() => action(reason));
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<Footer onClose={onClose} busy={busy} onSave={save} label={confirm} danger={danger} disabled={!optional && !reason.trim()} />}>
      <ErrorBox error={error} />
      <Field label={label}>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
