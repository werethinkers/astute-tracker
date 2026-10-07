import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAction, ErrorBox } from '../../ui.jsx';

const COLUMNS = ['venture', 'project', 'module', 'module_size', 'module_start', 'module_days', 'feature', 'feature_size', 'assignees'];
const SAMPLE = `venture,project,module,module_size,module_start,module_days,feature,feature_size,assignees
Astute Group,Field Ops App,Login and onboarding,large,2026-10-12,10,Phone OTP login,large,riya@example.com
Astute Group,Field Ops App,Login and onboarding,large,2026-10-12,10,Profile setup,medium,riya@example.com;arjun@example.com
Astute Group,Field Ops App,Reports,small,2026-10-26,5,Weekly summary PDF,medium,
`;

/** Small CSV parser: handles quoted fields, commas and newlines inside quotes. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function toObjects(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (!rows.length) return { rows: [], missing: COLUMNS };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = COLUMNS.filter((c) => c !== 'assignees' && !head.includes(c));
  return { rows: rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))), missing };
}

export default function Import() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const { busy, error, setError, run } = useAction();
  const parsed = text ? toObjects(text) : null;

  const check = async (commit) => {
    setResult(null);
    if (parsed.missing.length) return setError(`Missing columns: ${parsed.missing.join(', ')}.`);
    const out = await run(() => api.post('/import', { rows: parsed.rows, commit }), commit ? 'Imported' : null);
    if (out) setResult({ ...out, committed: commit });
  };
  const file = async (e) => {
    const f = e.target.files[0];
    if (f) {
      setText(await f.text());
      setResult(null);
    }
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'astute-import-template.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Import projects</h1>
          <div className="sub">Load ventures, projects, modules and features from a spreadsheet. One row per feature.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={template}>
            Download template
          </button>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="pb">
            <ErrorBox error={error} />
            <label className="field">
              <span>CSV file</span>
              <input className="input" type="file" accept=".csv,text/csv" onChange={file} />
            </label>
            <label className="field">
              <span>
                Or paste rows <span className="hint">export your sheet as CSV first</span>
              </span>
              <textarea className="input" rows={10} value={text} onChange={(e) => (setText(e.target.value), setResult(null))} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.82rem' }} />
            </label>
            {parsed && (
              <p className="small muted">
                {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} read.
              </p>
            )}
            <div className="gap8">
              <button className="btn" disabled={!parsed?.rows.length || busy} onClick={() => check(false)}>
                Check file
              </button>
              <button className="btn primary" disabled={!result?.preview || busy} onClick={() => check(true)}>
                Import
              </button>
            </div>
            {result?.errors && (
              <div className="err mt16">
                <strong>Fix these rows, then check again:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {result.errors.slice(0, 40).map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result?.preview && (
              <div className="note mt16">
                Ready: {result.preview.ventures} venture(s), {result.preview.projects} project(s), {result.preview.modules} module(s), {result.preview.features} feature(s). Existing items with the same names are reused, not duplicated.
              </div>
            )}
            {result?.imported && (
              <div className="note mt16">
                Imported {result.imported.features} features across {result.imported.modules} modules. See them in the <Link to="/portfolio">portfolio</Link>.
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Columns</h3>
          </div>
          <div className="pb small">
            <dl className="kv">
              <dt>venture</dt>
              <dd>Created if new</dd>
              <dt>project</dt>
              <dd>Created if new</dd>
              <dt>module</dt>
              <dd>Rows with the same module name are grouped</dd>
              <dt>module_size</dt>
              <dd>small, medium or large</dd>
              <dt>module_start</dt>
              <dd>Date, e.g. 2026-10-12</dd>
              <dt>module_days</dt>
              <dd>Working days; the end date skips days off</dd>
              <dt>feature</dt>
              <dd>Required on every row</dd>
              <dt>feature_size</dt>
              <dd>small, medium or large</dd>
              <dt>assignees</dt>
              <dd>Optional emails separated by semicolons; people must exist</dd>
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}
