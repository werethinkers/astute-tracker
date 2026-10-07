// Joins supabase/sql/*.sql into supabase/setup.sql: the one file to paste into the Supabase SQL editor.
// Run: node supabase/build-setup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'sql');
const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const header = `-- Astute Work Tracker: complete Supabase setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Safe to run again: it updates functions in place and never touches your data.
-- Generated from supabase/sql/*.sql by supabase/build-setup.mjs. Edit those files, not this one.
`;
const body = parts.map((f) => `\n-- >>>>>>>>>> ${f}\n` + fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const footer = `
-- >>>>>>>>>> next step
-- First install, or to clear everything out and keep one admin, run this line on its own with your own details:
--   select app.start_fresh('you@company.com', 'Your Name', 'TemporaryPass1');
select 'Setup complete. Next: run app.start_fresh(...) or app.add_admin(...) as described at the top of 07_owner.sql.' as result;
`;
fs.writeFileSync(path.join(here, 'setup.sql'), header + body + footer);
console.log(`Wrote supabase/setup.sql from ${parts.length} files.`);
