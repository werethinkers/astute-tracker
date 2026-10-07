import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, useAction, ErrorBox, Avatar } from '../ui.jsx';

export default function Account() {
  const { user, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, setError, run } = useAction();
  const save = async (e) => {
    e.preventDefault();
    if (next !== again) return setError('The new passwords do not match.');
    const ok = await run(() => api.post('/me/password', { current, next }), user.has_password ? 'Password changed' : 'Password set');
    if (ok) {
      setCurrent('');
      setNext('');
      setAgain('');
      refresh();
    }
  };
  return (
    <>
      <div className="head">
        <div className="person">
          <Avatar name={user.name} lg />
          <div>
            <h1>{user.name}</h1>
            <div className="sub">
              {user.email}, {user.role === 'admin' ? 'admin' : 'team member'}
            </div>
          </div>
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 520 }}>
        <div className="ph">
          <h3>{user.has_password ? 'Change password' : 'Set a password'}</h3>
        </div>
        <form className="pb" onSubmit={save}>
          {!user.has_password && <p className="small muted">You sign in with Google. A password lets you sign in without it too.</p>}
          <ErrorBox error={error} />
          {user.has_password && (
            <Field label="Current password">
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
          )}
          <Field label="New password" hint="at least 8 characters, with a number">
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="New password again">
            <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </Field>
          <button className="btn primary" disabled={busy}>
            {user.has_password ? 'Change password' : 'Set password'}
          </button>
          <p className="tiny muted mt8">Changing your password signs you out on other devices.</p>
        </form>
      </div>
    </>
  );
}
