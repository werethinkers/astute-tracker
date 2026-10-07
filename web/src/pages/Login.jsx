import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field } from '../ui.jsx';

function GoogleButton({ onError }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api.signInWithGoogle(); // leaves the page for Google, then comes back signed in
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn google" onClick={go} disabled={busy}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google…' : 'Sign in with Google'}
    </button>
  );
}

/** Errors Supabase puts in the address after a failed Google sign-in. */
function redirectError() {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const q = new URLSearchParams(window.location.search);
  const msg = h.get('error_description') || q.get('error_description');
  if (!msg) return null;
  window.history.replaceState(null, '', window.location.pathname);
  if (/Database error saving new user|not been added|created by admins/i.test(msg)) return 'This Google account has not been added to the tracker. Ask an admin to add your email on the People page.';
  return msg.replace(/\+/g, ' ');
}

/** Decorative plan lines: the same bars the app uses to show progress against the plan. */
function PlanArt() {
  const rows = [
    [0.82, 0.74],
    [0.46, 0.58],
    [0.93, 0.9],
    [0.3, 0.42],
    [0.66, 0.62],
    [0.18, 0.3],
  ];
  return (
    <svg className="lines" viewBox="0 0 400 260" aria-hidden="true">
      {rows.map(([done, tick], i) => (
        <g key={i} transform={`translate(0 ${i * 42})`}>
          <rect x="0" y="10" width="400" height="14" rx="2" fill="#2a2a2a" />
          <rect x="0" y="10" width={400 * done} height="14" rx="2" fill="#fff" />
          <rect x={400 * tick - 2} y="2" width="5" height="30" rx="2" fill="#fbb13f" />
        </g>
      ))}
    </svg>
  );
}

export default function Login() {
  const { refresh } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(redirectError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/auth/config').then(setCfg).catch(() => setCfg({}));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="art">
        <span />
        <div className="big">Know where every project stands, every day.</div>
        <PlanArt />
        <div className="small" style={{ color: '#bdbdbd', position: 'relative' }}>
          Astute Group work tracker
        </div>
      </div>
      <div className="form">
        <img src="/logo.png" alt="Astute Group" />
        <h1 style={{ marginBottom: 6 }}>Sign in</h1>
        <p className="muted mb16">Use the email your admin added for you.</p>
        {error && <div className="err">{error}</div>}
        {cfg?.google_client_id && (
          <>
            <GoogleButton onError={setError} />
            <div className="or">or with a password</div>
          </>
        )}
        <form onSubmit={submit}>
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn primary" style={{ width: '100%', padding: '10px' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small muted mt16">No account yet? Ask an admin to add you on the People page.</p>
      </div>
    </div>
  );
}
