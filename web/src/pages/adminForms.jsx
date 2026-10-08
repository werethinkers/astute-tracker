import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Field, useAction, ErrorBox, SizePicker, useApi, Avatar, fmtDate } from '../ui.jsx';

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
          Show progress percentages to the team
          <div className="tiny muted">When off, people see percentages only for the modules they work on.</div>
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

function PeoplePicker({ value, lead, onChange, onLead, fixed = [], youId }) {
  const people = useApi('/people');
  // Until the database update is run, admins can still read the full people list.
  const users = useApi(people.error ? '/users' : null);
  const list = people.data?.people || (users.data?.users || []).filter((u) => u.active);
  const picked = [...new Set([...fixed, ...value])];
  return (
    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 4 }}>
      {list.map((u) => {
        const locked = fixed.includes(u.id);
        const on = locked || value.includes(u.id);
        return (
          <div key={u.id} className="gap8" style={{ padding: '7px 10px', borderTop: '1px solid var(--line)' }}>
            <label className="gap8" style={{ flex: 1, cursor: locked ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                onChange={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])}
                style={{ accentColor: '#000' }}
              />
              <Avatar name={u.name} />
              <span>
                {u.name}
                {u.id === youId && <strong className="tiny"> (you)</strong>}
                <span className="tiny muted"> {u.title || (u.role === 'admin' ? 'Admin' : '')}</span>
              </span>
            </label>
            {on && picked.length > 1 && (
              <label className="tiny gap8" style={{ cursor: 'pointer' }}>
                <input type="radio" name="lead" checked={lead === u.id} onChange={() => onLead(u.id)} style={{ accentColor: '#000' }} />
                Lead
              </label>
            )}
          </div>
        );
      })}
      {(people.data || users.data) && !list.length && <div className="pb small muted">Add people on the People page first.</div>}
    </div>
  );
}

const norm = (x) => (x || '').trim().replace(/\s+/g, ' ').toLowerCase();
/** The first of `names` that is already used, ignoring case and spacing. */
export const clash = (name, names) => (norm(name) ? names.find((n) => norm(n) === norm(name)) : undefined);

/** Start date plus either a deadline or a number of working days. */
function Schedule({ f, setF, mode, setMode, editing }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Field group label="Plan the module by">
        <div className="seg" role="radiogroup" aria-label="Plan the module by">
          <button type="button" role="radio" aria-checked={mode === 'deadline'} className={mode === 'deadline' ? 'on' : ''} onClick={() => setMode('deadline')}>
            Deadline
          </button>
          <button type="button" role="radio" aria-checked={mode === 'days'} className={mode === 'days' ? 'on' : ''} onClick={() => setMode('days')}>
            Working days
          </button>
        </div>
      </Field>
      <div className="row">
        <Field label="Starts on">
          <input className="input" type="date" value={f.start_date || ''} onChange={set('start_date')} />
        </Field>
        {mode === 'deadline' ? (
          <Field label="Deadline" hint={editing ? 'the last day of this module' : 'if it falls on a day off, the module ends on the working day before'}>
            <input className="input" type="date" min={f.start_date || undefined} value={f.end_date || ''} onChange={set('end_date')} />
          </Field>
        ) : (
          <Field label="Duration" hint="working days; the end date skips days off and holidays">
            <input className="input" type="number" min={1} max={730} value={f.duration_days || ''} onChange={set('duration_days')} />
          </Field>
        )}
      </div>
    </>
  );
}
const scheduleBody = (f, mode) =>
  mode === 'deadline' ? { start_date: f.start_date, end_date: f.end_date } : { start_date: f.start_date, duration_days: Number(f.duration_days) };

export function ModuleForm({ projectId, projectName, existing = [], team, me, onClose, onDone }) {
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ name: '', description: '', size: 'medium', start_date: today, duration_days: 5, end_date: '' });
  const [mode, setMode] = useState(team ? 'deadline' : 'days');
  const [features, setFeatures] = useState([{ name: '', size: 'medium', requires_proof: false }]);
  const [people, setPeople] = useState([]);
  const [lead, setLead] = useState(team ? me.id : null);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const named = features.filter((x) => x.name.trim());
  const scheduled = f.start_date && (mode === 'deadline' ? f.end_date : f.duration_days);
  const open = existing.filter((m) => m.status !== 'cancelled');
  const sameModule = clash(f.name, open.map((m) => m.name));
  const repeated = named.find((x, i) => named.findIndex((y) => norm(y.name) === norm(x.name)) !== i);
  const save = async () => {
    const chosen = team ? [...new Set([me.id, ...people])] : people;
    const out = await run(
      () =>
        api.post(`/projects/${projectId}/modules`, {
          name: f.name,
          description: f.description,
          size: f.size,
          ...scheduleBody(f, mode),
          features: named,
          assignee_ids: chosen,
          lead_id: lead || chosen[0],
        }),
      team ? 'Module added. Your admin has been told.' : 'Module added'
    );
    if (out) {
      onDone?.(out);
      onClose();
    }
  };
  const setFeat = (i, k, v) => setFeatures(features.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal
      wide
      title={projectName ? `New module in ${projectName}` : 'New module'}
      onClose={onClose}
      footer={<Footer onClose={onClose} busy={busy} onSave={save} label="Add module" disabled={!f.name.trim() || !named.length || !scheduled || !!sameModule || !!repeated} />}
    >
      {team && (
        <p className="small muted">
          You plan this module: its features, who works on it and when it is due. Once you add it, only an admin can change its dates.
        </p>
      )}
      {open.length > 0 && (
        <details className="note mb16">
          <summary>
            <strong>Already in this project:</strong> {open.length} module{open.length === 1 ? '' : 's'}. Check before adding, and join one instead if it covers your
            work.
          </summary>
          <ul className="small mt8" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {open.map((m) => (
              <li key={m.id}>
                <strong>{m.name}</strong>
                {m.features.length > 0 && <span className="muted">: {m.features.filter((x) => x.status !== 'cancelled').map((x) => x.name).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ErrorBox error={error} />
      <div className="row">
        <Field label="Module name">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
          {sameModule && (
            <div className="tiny mt8" style={{ color: 'var(--red)' }}>
              "{sameModule}" already exists in this project. Close this and press Join module on it instead.
            </div>
          )}
        </Field>
        <Field group label="Size" hint="sets its share of the project">
          <SizePicker value={f.size} onChange={(v) => setF({ ...f, size: v })} />
        </Field>
      </div>
      <Field label="Description" hint="optional">
        <textarea className="input" rows={2} value={f.description} onChange={set('description')} />
      </Field>
      <Schedule f={f} setF={setF} mode={mode} setMode={setMode} />
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
          {repeated && (
            <div className="tiny mb8" style={{ color: 'var(--red)' }}>
              "{repeated.name.trim()}" is listed twice.
            </div>
          )}
          <button type="button" className="btn sm" onClick={() => setFeatures([...features, { name: '', size: 'medium', requires_proof: false }])}>
            Add another feature
          </button>
        </div>
      </Field>
      <Field
        group
        label={team ? 'Who works on it' : 'Assign people'}
        hint={team ? "you're on it; tick anyone else who works on it" : 'optional; they see every feature in this module'}
      >
        <PeoplePicker value={people} lead={lead} onChange={setPeople} onLead={setLead} fixed={team ? [me.id] : []} youId={me?.id} />
      </Field>
    </Modal>
  );
}

export function ModuleEdit({ module, admin = true, onClose, onDone }) {
  const [f, setF] = useState({
    name: module.name,
    description: module.description || '',
    size: module.size,
    start_date: module.start_date,
    duration_days: module.duration_days,
    end_date: module.end_date,
    reason: '',
  });
  const [mode, setMode] = useState('deadline');
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const scheduleChanged =
    admin &&
    (f.start_date !== module.start_date || (mode === 'deadline' ? f.end_date !== module.end_date : Number(f.duration_days) !== module.duration_days));
  const save = async () => {
    const body = { name: f.name, description: f.description, size: f.size };
    if (scheduleChanged) Object.assign(body, scheduleBody(f, mode), { reason: f.reason });
    const ok = await run(() => api.patch(`/items/${module.id}`, body), 'Module saved');
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
      {admin ? (
        <Schedule f={f} setF={setF} mode={mode} setMode={setMode} editing />
      ) : (
        <div className="note small">
          Runs {fmtDate(module.start_date)} to {fmtDate(module.end_date)}. The deadline is set, so only an admin can change the dates.
        </div>
      )}
      {scheduleChanged && (
        <Field label="Why the schedule is changing" hint="required; kept in the history, and the original deadline stays on record">
          <input className="input" value={f.reason} onChange={set('reason')} />
        </Field>
      )}
    </Modal>
  );
}

export function FeatureForm({ module, feature, me, admin = true, onClose, onDone }) {
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
  const others = (module.features || []).filter((x) => x.id !== feature?.id && x.status !== 'cancelled').map((x) => x.name);
  const taken = clash(f.name, others);
  const save = async () => {
    const body = { name: f.name, description: f.description, size: f.size, requires_proof: f.requires_proof };
    if (feature && admin) {
      if (f.manual) Object.assign(body, { planned_start: f.planned_start, planned_end: f.planned_end });
      else if (feature.manual_dates) body.manual_dates = false;
    } else if (!feature && people.length) body.assignee_ids = people;
    const ok = await run(() => (feature ? api.patch(`/items/${feature.id}`, body) : api.post(`/items/${module.id}/features`, body)), feature ? 'Feature saved' : 'Feature added');
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal
      title={feature ? 'Edit feature' : `Add a feature to ${module.name}`}
      onClose={onClose}
      footer={<Footer onClose={onClose} busy={busy} onSave={save} label={feature ? 'Save feature' : 'Add feature'} disabled={!f.name.trim() || !!taken} />}
    >
      <ErrorBox error={error} />
      <Field label="Feature name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
        {taken && (
          <div className="tiny mt8" style={{ color: 'var(--red)' }}>
            {module.name} already has "{taken}". Join that feature instead.
          </div>
        )}
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
      {feature && !admin && <div className="note small">Planned {fmtDate(feature.planned_start)} to {fmtDate(feature.planned_end)}. Only an admin can change dates.</div>}
      {feature && admin && (
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
          <PeoplePicker value={people} lead={null} onChange={setPeople} onLead={() => {}} youId={me?.id} />
        </Field>
      )}
    </Modal>
  );
}

export function AssignModal({ item, me, onClose, onDone }) {
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
      <PeoplePicker value={people} lead={lead} onChange={setPeople} onLead={setLead} youId={me?.id} />
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
