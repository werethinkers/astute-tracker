import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useApi, Loading, ErrorBox, Avatar, Modal, Field, useAction, fmtWhen } from '../../ui.jsx';

function UserForm({ user, onClose, onDone }) {
  const { user: me } = useAuth();
  const [f, setF] = useState({
    name: user?.name || '',
    email: user?.email || '',
    title: user?.title || '',
    role: user?.role || 'workforce',
    active: user ? user.active : true,
    password: '',
  });
  const [withPassword, setWithPassword] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const self = user && user.id === me.id;
  const save = async () => {
    const body = { name: f.name, email: f.email, title: f.title, role: f.role };
    if (user) body.active = f.active;
    if (withPassword && f.password) body.password = f.password;
    const ok = await run(() => (user ? api.patch(`/users/${user.id}`, body) : api.post('/users', body)), user ? 'Saved' : `${f.name} added`);
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'Add a person'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.name.trim() || !f.email.trim() || (withPassword && f.password.length < 8)} onClick={save}>
            {user ? 'Save' : 'Add person'}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="row">
        <Field label="Full name">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Job title" hint="optional">
          <input className="input" value={f.title} onChange={set('title')} />
        </Field>
      </div>
      <Field label="Email" hint="their Google account email lets them use Sign in with Google">
        <input className="input" type="email" value={f.email} onChange={set('email')} />
      </Field>
      <Field group label="Access">
        <div className="seg">
          <button type="button" className={f.role === 'workforce' ? 'on' : ''} onClick={() => setF({ ...f, role: 'workforce' })} disabled={self}>
            Workforce
          </button>
          <button type="button" className={f.role === 'admin' ? 'on' : ''} onClick={() => setF({ ...f, role: 'admin' })}>
            Admin
          </button>
        </div>
        <span className="tiny muted">
          {f.role === 'admin' ? 'Sees every project, all people and all flags; approves work.' : 'Sees only the modules and features assigned to them; never sees flags.'}
        </span>
      </Field>
      <label className="check">
        <input type="checkbox" checked={withPassword} onChange={(e) => setWithPassword(e.target.checked)} />
        <span>
          {user ? 'Reset their password' : 'Give them a temporary password'}
          <div className="tiny muted">{user ? 'Signs them out everywhere. Share it privately.' : 'Leave off for Google sign-in only. Share it privately and ask them to change it.'}</div>
        </span>
      </label>
      {withPassword && (
        <Field label="Password" hint="at least 8 characters, with a number">
          <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
      )}
      {user && !self && (
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={set('active')} />
          <span>
            Active
            <div className="tiny muted">Deactivated people cannot sign in. Their open work is flagged as unassigned so you can hand it on.</div>
          </span>
        </label>
      )}
    </Modal>
  );
}

export default function Users() {
  const { data, loading, error, reload } = useApi('/users');
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const active = data.users.filter((u) => u.active);
  return (
    <>
      <div className="head">
        <div>
          <h1>People</h1>
          <div className="sub">
            {active.length} active, {active.filter((u) => u.role === 'admin').length} admins. Only people added here can sign in.
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setModal({ user: null })}>
            Add a person
          </button>
        </div>
      </div>
      <div className="panel scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Access</th>
              <th>Sign-in</th>
              <th className="r">Open work</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                <td>
                  <div className="person">
                    <Avatar name={u.name} />
                    <div>
                      <Link to={`/people/${u.id}`} style={{ fontWeight: 600 }}>
                        {u.name}
                      </Link>
                      <div className="tiny muted">
                        {u.email}
                        {u.title ? `, ${u.title}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{u.active ? (u.role === 'admin' ? <strong>Admin</strong> : 'Workforce') : 'Deactivated'}</td>
                <td className="small">{u.has_password ? 'Password or Google' : 'Google only'}</td>
                <td className="r num">{u.open_assignments || ''}</td>
                <td className="small muted">{u.last_login_at ? fmtWhen(u.last_login_at) : 'Never'}</td>
                <td className="r">
                  <button className="btn sm" onClick={() => setModal({ user: u })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <UserForm user={modal.user} onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}
