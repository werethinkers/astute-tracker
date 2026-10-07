// LOCAL TESTING ONLY: stands in for Supabase (sign-in, the api() call, file storage) over a plain Postgres
// that has supabase/local/stubs.sql and supabase/setup.sql loaded. Every request runs as the signed-in person
// with the same role and claims Supabase would use, so the database's own permission checks are exercised.
//
//   PGHOST=/var/run/postgresql PGPORT=5432 PGDATABASE=tracker node supabase/local/server.mjs
//   then build the web app with VITE_BACKEND=local (npm run build:local) and open http://localhost:4400
import express from 'express';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, process.env.LOCAL_DIST || 'dist-local');
const store = process.env.LOCAL_FILES || path.join(root, '.local-files');
fs.mkdirSync(store, { recursive: true });
const pool = new pg.Pool({
  host: process.env.PGHOST || '/var/run/postgresql',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'tracker',
});

/** Run fn inside a transaction as the given Supabase user (role authenticated, JWT claims set). */
async function asUser(uid, fn) {
  const c = await pool.connect();
  try {
    const { rows } = await c.query('select email from auth.users where id = $1', [uid || null]);
    if (!rows.length) throw Object.assign(new Error('JWT expired'), { status: 401 });
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, email: rows[0].email, role: 'authenticated' })]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const send = (res, e) => res.status(e.status || 400).json({ message: e.message, hint: e.hint, code: e.code });

const app = express();
app.use(express.json({ limit: '5mb' }));

app.post('/local/login', async (req, res) => {
  const { rows } = await pool.query(
    `update auth.users set last_sign_in_at = now()
     where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password) returning id, email`,
    [req.body.email || '', req.body.password || '']
  );
  if (!rows.length) return res.status(400).json({ message: 'Invalid login credentials' });
  res.json({ uid: rows[0].id, email: rows[0].email });
});

app.post('/local/password', async (req, res) => {
  const uid = req.get('x-user');
  await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 10)) where id = $1`, [uid, req.body.password]);
  res.json({ ok: true });
});

app.post('/local/rpc', async (req, res) => {
  try {
    const data = await asUser(req.get('x-user'), async (c) => {
      const r = await c.query('select public.api($1, $2, $3) j', [req.body.method, req.body.path, req.body.body ?? {}]);
      return r.rows[0].j;
    });
    res.json({ data });
  } catch (e) {
    send(res, e);
  }
});

app.post('/local/upload', async (req, res) => {
  try {
    const form = await new Request('http://local/upload', { method: 'POST', headers: req.headers, body: req, duplex: 'half' }).formData();
    const key = String(form.get('path'));
    const file = form.get('file');
    if (file.size > 25 * 1024 * 1024) throw new Error('The object exceeded the maximum allowed size');
    await asUser(req.get('x-user'), (c) => c.query(`insert into storage.objects (bucket_id, name, owner) values ('submissions', $1, auth.uid())`, [key]));
    const full = path.join(store, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(await file.arrayBuffer()));
    res.json({ ok: true });
  } catch (e) {
    send(res, e);
  }
});

app.post('/local/remove', async (req, res) => {
  try {
    const gone = await asUser(req.get('x-user'), (c) =>
      c.query(`delete from storage.objects where bucket_id = 'submissions' and name = any($1) returning name`, [req.body.paths || []])
    );
    for (const r of gone.rows) fs.rmSync(path.join(store, r.name), { force: true });
    res.json({ ok: true });
  } catch (e) {
    send(res, e);
  }
});

const signed = new Map();
app.post('/local/sign', async (req, res) => {
  try {
    const ok = await asUser(req.get('x-user'), (c) =>
      c.query(`select name from storage.objects where bucket_id = 'submissions' and name = $1`, [req.body.path])
    );
    if (!ok.rows.length) throw new Error('Object not found');
    const token = crypto.randomUUID();
    signed.set(token, { key: req.body.path, name: req.body.name, until: Date.now() + 120000 });
    res.json({ url: `/local/file/${token}` });
  } catch (e) {
    send(res, e);
  }
});
app.get('/local/file/:token', (req, res) => {
  const s = signed.get(req.params.token);
  if (!s || s.until < Date.now()) return res.status(404).send('Link expired');
  res.download(path.join(store, s.key), s.name || path.basename(s.key));
});

app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.LOCAL_PORT || 4400);
app.listen(port, () => console.log(`Local tracker (Supabase stand-in) at http://localhost:${port}`));
