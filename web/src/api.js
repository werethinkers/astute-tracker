// The app talks to one function in the database, api(method, path, body), with the same paths the old
// Express server had. Sign-in, password changes and file uploads go to Supabase Auth and Storage first.
import { backend } from './backend.js';

const GOOGLE = import.meta.env.VITE_GOOGLE_SIGNIN === 'on';

function friendly(msg = '') {
  if (/Invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
  if (/Email not confirmed/i.test(msg)) return 'This account is not confirmed yet. Ask an admin to reset your password.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Could not reach the server. Check your internet connection and try again.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return 'Each file must be 25 MB or smaller.';
  if (/permission denied for function api|JWT expired|invalid JWT/i.test(msg)) return 'Sign in to continue.';
  return msg;
}

function toError(e) {
  const raw = e?.message || String(e || '');
  let status = Number(e?.hint) || Number(e?.status) || 0;
  if (!status && (/permission denied for function api|JWT/i.test(raw) || e?.code === '42501' || e?.code === 'PGRST301')) status = 401;
  const err = new Error(friendly(raw) || 'Request failed.');
  err.status = status || 400;
  return err;
}

async function call(method, path, body) {
  const s = await backend.session();
  if (!s) {
    const err = new Error('Sign in to continue.');
    err.status = 401;
    throw err;
  }
  try {
    return await backend.rpc(method, path, body ?? {});
  } catch (e) {
    const err = toError(e);
    if (err.status === 401 && !path.startsWith('/me')) window.dispatchEvent(new Event('awt:signed-out'));
    throw err;
  }
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

async function signIn({ email, password }) {
  try {
    await backend.signIn(String(email || '').trim().toLowerCase(), password);
  } catch (e) {
    throw toError(e);
  }
  try {
    return await call('GET', '/me');
  } catch (e) {
    await backend.signOut();
    throw e;
  }
}

async function changePassword({ current, next }) {
  const problem = passwordProblem(next);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const { user } = await call('GET', '/me');
  if (user.has_password) {
    try {
      await backend.signIn(user.email, current || '');
    } catch {
      throw Object.assign(new Error('Your current password is incorrect.'), { status: 400 });
    }
  }
  try {
    await backend.updatePassword(next);
  } catch (e) {
    throw toError(e);
  }
  return { ok: true };
}

const safeName = (n) => (String(n || 'file').replace(/[^\w.-]+/g, '_').slice(-80) || 'file');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** "Mark as done": upload the documents to storage, then record the submission. */
async function submitWork(path, form) {
  const s = await backend.session();
  if (!s) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  const note = form.get('note') || '';
  let links = form.get('links') || '[]';
  try {
    links = JSON.parse(links);
  } catch {
    links = String(links).split(/\s+/);
  }
  const files = form.getAll('files').filter((f) => f && typeof f === 'object');
  if (files.length > 10) throw Object.assign(new Error('Attach at most 10 files.'), { status: 400 });
  for (const f of files) if (f.size > 25 * 1024 * 1024) throw Object.assign(new Error('Each file must be 25 MB or smaller.'), { status: 400 });
  const uploaded = [];
  try {
    for (const f of files) {
      const key = `${s.uid}/${uuid()}-${safeName(f.name)}`;
      await backend.upload(key, f);
      uploaded.push({ path: key, name: f.name, mime: f.type || 'application/octet-stream', size: f.size });
    }
    return await call('POST', path, { note, links, files: uploaded });
  } catch (e) {
    await backend.remove(uploaded.map((u) => u.path)).catch(() => {});
    throw e.status ? e : toError(e);
  }
}

async function request(method, url, body) {
  if (url === '/auth/config') return { google_client_id: GOOGLE ? 'supabase' : null, org_name: 'Astute Group' };
  if (url === '/auth/login') return signIn(body || {});
  if (url === '/auth/logout') {
    await backend.signOut();
    return { ok: true };
  }
  if (url === '/me/password') return changePassword(body || {});
  if (typeof FormData !== 'undefined' && body instanceof FormData) return submitWork(url, body);
  return call(method, url, body);
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  del: (u) => request('DELETE', u),
  /** A short-lived download link for a submitted document, after checking the viewer may see it. */
  fileUrl: async (fileId) => {
    const f = await call('GET', `/files/${fileId}`);
    try {
      return await backend.fileUrl(f.path, f.file_name);
    } catch (e) {
      throw toError(e);
    }
  },
  signInWithGoogle: () => backend.signInWithGoogle(),
  onAuthChange: (cb) => backend.onChange(cb),
};
