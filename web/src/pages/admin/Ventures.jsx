import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, Loading, ErrorBox, Modal, Field, useAction, fmtDateY, Empty } from '../../ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const offsText = (v) => (String(v || '') === '' ? 'None' : String(v).split(',').map((d) => DAYS[Number(d)]).join(', '));

function DayPicker({ value, onChange }) {
  const set = new Set(String(value || '').split(',').filter((x) => x !== ''));
  return (
    <div className="seg">
      {DAYS.map((d, i) => (
        <button
          type="button"
          key={d}
          className={set.has(String(i)) ? 'on' : ''}
          onClick={() => {
            const s = new Set(set);
            s.has(String(i)) ? s.delete(String(i)) : s.add(String(i));
            onChange([...s].sort().join(','));
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function VentureForm({ venture, onClose, onDone }) {
  const [f, setF] = useState({
    name: venture?.name || '',
    weekly_offs: venture?.weekly_offs ?? '0',
    weight_small: venture?.weight_small ?? 1,
    weight_medium: venture?.weight_medium ?? 2,
    weight_large: venture?.weight_large ?? 4,
  });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f, weight_small: Number(f.weight_small), weight_medium: Number(f.weight_medium), weight_large: Number(f.weight_large) };
    const ok = await run(() => (venture ? api.patch(`/companies/${venture.id}`, body) : api.post('/companies', body)), venture ? 'Venture saved' : 'Venture added');
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={venture ? `Edit ${venture.name}` : 'Add a venture'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>
            Save venture
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <Field label="Venture name">
        <input className="input" value={f.name} onChange={set('name')} autoFocus />
      </Field>
      <Field group label="Weekly days off" hint="deadlines skip these days">
        <DayPicker value={f.weekly_offs} onChange={(v) => setF({ ...f, weekly_offs: v })} />
      </Field>
      <Field group label="Size weights" hint="how much a small, medium and large item counts; applies to items created or resized from now on">
        <div className="row">
          {['small', 'medium', 'large'].map((s) => (
            <label key={s} className="field" style={{ flex: '1 1 90px' }}>
              <span className="tiny">{s[0].toUpperCase() + s.slice(1)}</span>
              <input className="input" type="number" min={1} max={20} value={f[`weight_${s}`]} onChange={set(`weight_${s}`)} />
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function Holidays({ venture, onClose }) {
  const { data, reload } = useApi(`/companies/${venture.id}/holidays`);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const add = async () => {
    const ok = await run(() => api.post(`/companies/${venture.id}/holidays`, { date, name }), 'Holiday added; deadlines recalculated');
    if (ok) {
      setDate('');
      setName('');
      reload();
    }
  };
  return (
    <Modal title={`Holidays for ${venture.name}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="small muted">Module deadlines skip these days. Adding one moves the end dates of modules that span it.</p>
      <ErrorBox error={error} />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali" />
        </Field>
        <button className="btn primary" style={{ marginBottom: 14 }} disabled={busy || !date || !name.trim()} onClick={add}>
          Add
        </button>
      </div>
      <div className="divide">
        {(data?.holidays || []).map((h) => (
          <div key={h.id} className="gap8" style={{ justifyContent: 'space-between', padding: '8px 0' }}>
            <span>
              {fmtDateY(h.date)} <span className="muted">{h.name}</span>
            </span>
            <button className="btn sm ghost" onClick={() => run(() => api.del(`/holidays/${h.id}`), 'Holiday removed').then(reload)}>
              Remove
            </button>
          </div>
        ))}
        {data && !data.holidays.length && <div className="small muted">No holidays yet.</div>}
      </div>
    </Modal>
  );
}

const SETTINGS = [
  ['min_note_chars', 'Minimum completion note', 'characters'],
  ['flag_review_days', 'Flag a review left waiting after', 'working days'],
  ['flag_blocked_days', 'Flag blocked work after', 'working days'],
  ['flag_stalled_days', 'Flag in-progress work with no log for', 'working days'],
  ['flag_overload_count', 'Flag a person with more than', 'features due in 2 working days'],
  ['flag_scope_growth_pct', 'Flag a module whose added features exceed', '% of its planned weight'],
];

function Settings() {
  const { data, reload } = useApi('/admin/settings');
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  if (!data) return null;
  const v = f || data.settings;
  const save = async () => {
    const ok = await run(() => api.patch('/admin/settings', v), 'Settings saved');
    if (ok) {
      setF(null);
      reload();
    }
  };
  return (
    <div className="panel mt24" style={{ maxWidth: 760 }}>
      <div className="ph">
        <h2>Group rules</h2>
      </div>
      <div className="pb">
        <ErrorBox error={error} />
        <Field group label="Group weekly days off" hint="used for daily target lists and log locking">
          <DayPicker value={v.default_weekly_offs} onChange={(x) => setF({ ...v, default_weekly_offs: x })} />
        </Field>
        {SETTINGS.map(([k, label, unit]) => (
          <div key={k} className="gap8 mb8">
            <span style={{ flex: '1 1 300px' }}>{label}</span>
            <input className="input" type="number" style={{ width: 90 }} value={v[k] ?? ''} onChange={(e) => setF({ ...v, [k]: e.target.value })} aria-label={label} />
            <span className="small muted" style={{ flex: '1 1 160px' }}>
              {unit}
            </span>
          </div>
        ))}
        <button className="btn primary mt8" disabled={busy || !f} onClick={save}>
          Save rules
        </button>
      </div>
    </div>
  );
}

export default function Ventures() {
  const { data, loading, error, reload } = useApi('/companies');
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="head">
        <div>
          <h1>Ventures and calendar</h1>
          <div className="sub">Each venture has its own days off, holidays and size weights.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setModal({ kind: 'edit', v: null })}>
            Add a venture
          </button>
        </div>
      </div>
      <div className="panel scroll-x">
        {!data.companies.length ? (
          <Empty title="No ventures yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Venture</th>
                <th>Days off</th>
                <th>Weights S / M / L</th>
                <th className="r">Holidays</th>
                <th className="r">Projects</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{offsText(c.weekly_offs)}</td>
                  <td className="num">
                    {c.weight_small} / {c.weight_medium} / {c.weight_large}
                  </td>
                  <td className="r num">{c.holiday_count}</td>
                  <td className="r num">{c.project_count}</td>
                  <td className="r nowrap">
                    <button className="btn sm" onClick={() => setModal({ kind: 'holidays', v: c })}>
                      Holidays
                    </button>{' '}
                    <button className="btn sm" onClick={() => setModal({ kind: 'edit', v: c })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Settings />
      {modal?.kind === 'edit' && <VentureForm venture={modal.v} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'holidays' && <Holidays venture={modal.v} onClose={() => (setModal(null), reload())} />}
    </>
  );
}
