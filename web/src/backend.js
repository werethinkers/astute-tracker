// Where the data lives. In production this is Supabase (sign-in, the database's api() function, file storage).
// With VITE_BACKEND=local the same calls go to supabase/local/server.mjs, a test server over a plain Postgres.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'submissions';

function supabaseBackend() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set when building.');
  const sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return {
    async session() {
      const { data } = await sb.auth.getSession();
      const s = data.session;
      return s ? { uid: s.user.id, email: s.user.email } : null;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },
    async rpc(method, path, body) {
      const { data, error } = await sb.rpc('api', { method, path, body });
      if (error) throw error;
      return data;
    },
    async upload(path, file) {
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) throw error;
    },
    async remove(paths) {
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    },
    async fileUrl(path, name) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120, { download: name || true });
      if (error) throw error;
      return data.signedUrl;
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => cb(event));
      return () => data.subscription.unsubscribe();
    },
  };
}

function localBackend() {
  const KEY = 'awt_local_session';
  const listeners = new Set();
  const get = () => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY));
    } catch {
      return null;
    }
  };
  const emit = (e) => listeners.forEach((f) => f(e));
  const call = async (url, payload) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user': get()?.uid || '' },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.message || 'Request failed.'), j);
    return j;
  };
  return {
    async session() {
      return get();
    },
    async signIn(email, password) {
      const s = await call('/local/login', { email, password });
      sessionStorage.setItem(KEY, JSON.stringify(s));
      emit('SIGNED_IN');
    },
    async signOut() {
      sessionStorage.removeItem(KEY);
      emit('SIGNED_OUT');
    },
    async signInWithGoogle() {
      throw new Error('Google sign-in is not available in local mode.');
    },
    async updatePassword(password) {
      await call('/local/password', { password });
    },
    async rpc(method, path, body) {
      return (await call('/local/rpc', { method, path, body })).data;
    },
    async upload(path, file) {
      const fd = new FormData();
      fd.append('path', path);
      fd.append('file', file);
      const res = await fetch('/local/upload', { method: 'POST', headers: { 'x-user': get()?.uid || '' }, body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Upload failed.');
    },
    async remove(paths) {
      if (paths.length) await call('/local/remove', { paths });
    },
    async fileUrl(path, name) {
      const { url } = await call('/local/sign', { path, name });
      return url;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export const backend = import.meta.env.VITE_BACKEND === 'local' ? localBackend() : supabaseBackend();
