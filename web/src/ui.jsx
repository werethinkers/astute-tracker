import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// ---------- data hooks ----------
export function useApi(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.get(url);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (n === seq.current) setState({ data: null, error: e.message, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef();
  const show = useCallback((msg, bad = false) => {
    clearTimeout(timer.current);
    setT({ msg, bad });
    timer.current = setTimeout(() => setT(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={`toast${t.bad ? ' bad' : ''}`} role="status">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- dates ----------
const dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dFmtY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (d) => (d ? dFmt.format(new Date(d.slice(0, 10) + 'T00:00:00Z')) : '—');
export const fmtDateY = (d) => (d ? dFmtY.format(new Date(d.slice(0, 10) + 'T00:00:00Z')) : '—');
export function fmtWhen(ts) {
  if (!ts) return '';
  const t = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return dFmtY.format(t);
}
export const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);

/** A submitted document. Clicking asks for a short-lived private link, then downloads it. */
export function FileLink({ file, children }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      window.location.href = await api.fileUrl(file.id);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <a href="#" onClick={open} aria-busy={busy}>
      {children}
    </a>
  );
}
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

// ---------- small components ----------
export const STATUS_LABEL = {
  proposed: 'Proposed',
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  submitted: 'In review',
  done: 'Done',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};
export function Status({ s, sentBack }) {
  if (sentBack && s === 'in_progress') return <span className="pill sentback">Sent back</span>;
  return <span className={`pill ${s}`}>{STATUS_LABEL[s] || s}</span>;
}
export function Size({ s }) {
  return (
    <span className={`size ${s}`} title={`${s[0].toUpperCase() + s.slice(1)} size`}>
      {s[0].toUpperCase()}
    </span>
  );
}
export function Avatar({ name, lg }) {
  return (
    <span className={`avatar${lg ? ' lg' : ''}`} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
export function Avatars({ people = [] }) {
  if (!people.length) return <span className="faint small">Unassigned</span>;
  return (
    <span className="avatars" title={people.map((p) => p.name).join(', ')}>
      {people.slice(0, 4).map((p) => (
        <Avatar key={p.id ?? p.name} name={p.name} />
      ))}
      {people.length > 4 && <span className="avatar">+{people.length - 4}</span>}
    </span>
  );
}

/** The plan line: done (solid), in review (hatched), and where the plan says it should be by now (amber tick). */
export function PlanLine({ done = 0, review = 0, expected, thin, showPct = true }) {
  const d = Math.max(0, Math.min(100, done));
  const r = Math.max(0, Math.min(100 - d, review));
  const label = `${Math.round(d)}% done${r ? `, ${Math.round(r)}% in review` : ''}${expected != null ? `, plan expects ${Math.round(expected)}% by now` : ''}`;
  const bar = (
    <div className={`plan${thin ? ' thin' : ''}`} role="img" aria-label={label} title={label}>
      <div className="done" style={{ width: `${d}%` }} />
      {r > 0 && <div className="review" style={{ left: `${d}%`, width: `${r}%` }} />}
      {expected != null && expected > 0 && <div className="tick" style={{ left: `${Math.min(100, expected)}%` }} />}
    </div>
  );
  if (!showPct) return bar;
  return (
    <div className="planrow">
      {bar}
      <span className="pct">{Math.round(d)}%</span>
    </div>
  );
}
export function PlanLegend() {
  return (
    <div className="legend">
      <span>
        <i className="k-done" />
        Done
      </span>
      <span>
        <i className="k-review" />
        In review
      </span>
      <span>
        <i className="k-tick" />
        Where the plan says it should be today
      </span>
    </div>
  );
}

const HEALTH = { green: 'On track', amber: 'Slipping', red: 'Behind', none: 'Too early to tell', done: 'Complete' };
export function Health({ h, word = true }) {
  return (
    <span className="gap8" title={HEALTH[h]}>
      <span className={`dot ${h}`} />
      {word && <span className={`healthword ${h}`}>{HEALTH[h]}</span>}
    </span>
  );
}

export function DaysLeft({ n, end }) {
  if (n == null) return <span className="faint">No dates</span>;
  if (n < 0) return <span style={{ color: 'var(--red)', fontWeight: 600 }}>{-n} working day{n === -1 ? '' : 's'} late</span>;
  if (n === 0) return <span>Ended {fmtDate(end)}</span>;
  if (n === 1) return <span>Due today</span>;
  return (
    <span>
      {n} working days left <span className="faint">· {fmtDate(end)}</span>
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mhd">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="mbd">{children}</div>
        {footer && <div className="mft">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled form row. Use `group` when the children are several controls (buttons, checklists),
 *  so clicks on the row do not get redirected to its first control. */
export function Field({ label, hint, children, group }) {
  const head = (
    <span>
      {label} {hint && <span className="hint">{hint}</span>}
    </span>
  );
  if (group)
    return (
      <div className="field" role="group" aria-label={label}>
        {head}
        {children}
      </div>
    );
  return (
    <label className="field">
      {head}
      {children}
    </label>
  );
}

export function SizePicker({ value, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Size">
      {['small', 'medium', 'large'].map((s) => (
        <button type="button" key={s} className={value === s ? 'on' : ''} onClick={() => onChange(s)} role="radio" aria-checked={value === s}>
          {s[0].toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <span className="spin" /> Loading
    </div>
  );
}
export function ErrorBox({ error }) {
  return error ? <div className="err">{error}</div> : null;
}
export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Submit handler helper: runs fn, shows the error inline, toasts on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (fn, success) => {
      setBusy(true);
      setError(null);
      try {
        const out = await fn();
        if (success) toast(success);
        return out ?? true;
      } catch (e) {
        setError(e.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );
  return { busy, error, setError, run };
}
