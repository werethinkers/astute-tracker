import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/* One page, two roles. The database decides which one you are (public.hiring_api):
   - a candidate (login created by the admin) sees only their own assignment;
   - the hiring admin sees the board. Nothing here is trusted: every rule is enforced in SQL. */

const CANDIDATE_DOMAIN = "ezyourlife.com"; // User ID "sumit" signs in as cand-sumit@ezyourlife.com
const STAGES = [
  { key: "applied", label: "Applied" },
  { key: "interview", label: "Interview" },
  { key: "assignment", label: "Assignment" },
  { key: "office", label: "Office round" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
];
const REVIEW_STAGES = [
  { key: "interview", label: "Interview" },
  { key: "assignment", label: "Assignment" },
  { key: "office", label: "Office round" },
];
const STATUS_LABEL = { not_started: "Not started", running: "In progress", submitted: "Submitted", closed: "Time ended" };
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 40;
const HOUR = 3600 * 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const clean = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label ?? key;
const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";
const isHttpUrl = (u) => /^https?:\/\//i.test(u || "");
const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};
const humanLeft = (ms) => {
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const state = { user: null, role: null, candidates: [], evals: [], openId: null, justCreated: null, offset: 0, me: null };
let supabase = null;
let tickTimer = null;
let toastTimer = null;
let saveTimer = null;
let dirtyAnswer = false;
let subCtx = null; // admin: the open candidate's questions and code

// Time on the server minus time on this device, so a wrong laptop clock cannot fool the countdown.
const setOffset = (serverNow) => {
  if (serverNow) state.offset = new Date(serverNow).getTime() - Date.now();
};
const now = () => Date.now() + state.offset;

/* ---------- views ---------- */
function show(view) {
  for (const id of ["login-view", "app-view"]) $("#" + id).hidden = id !== view;
}

function showPanel(which) {
  $("#candidate-view").hidden = which !== "candidate";
  $("#content").hidden = which !== "admin";
  $("#denied").hidden = which !== "denied";
  for (const el of document.querySelectorAll(".admin-only")) el.hidden = which !== "admin";
}

function showDenied(message) {
  $("#denied-msg").textContent = message;
  showPanel("denied");
}

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 2800);
}

/* ---------- api (one RPC, see supabase/sql/08_hiring.sql) ---------- */
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, body = {}) {
  const { data, error } = await supabase.rpc("hiring_api", { method, path, body });
  if (!error) return data;
  if (error.code === "PGRST202" || error.code === "42883") {
    throw new ApiError("The hiring tables are not set up yet. Run supabase/sql/08_hiring.sql in the Supabase SQL Editor.", 404);
  }
  const status = Number(error.hint) || (error.code === "42501" ? 403 : 500);
  throw new ApiError(error.message || "Something went wrong.", status);
}

function handleError(e, prefix) {
  if (e.status === 401) {
    supabase.auth.signOut();
    return;
  }
  if (e.status === 403 && state.role !== "candidate" && /restricted|no account|admin/i.test(e.message)) {
    closeDrawer();
    showDenied(e.message);
    return;
  }
  toast(prefix ? `${prefix}: ${e.message}` : e.message, true);
}

/* ---------- auth ---------- */
const toEmail = (id) => {
  const v = id.trim().toLowerCase();
  return v.includes("@") ? v : `cand-${v}@${CANDIDATE_DOMAIN}`;
};

async function onLogin(event) {
  event.preventDefault();
  const id = $("#login-id").value;
  const password = $("#login-pass").value;
  const err = $("#login-error");
  err.hidden = true;
  if (!id.trim() || !password) {
    err.textContent = "Enter your User ID and password.";
    err.hidden = false;
    return;
  }
  const btn = $("#login-btn");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  const { error } = await supabase.auth.signInWithPassword({ email: toEmail(id), password });
  btn.disabled = false;
  btn.textContent = "Sign in";
  if (error) {
    err.textContent = "Wrong User ID or password.";
    err.hidden = false;
    return;
  }
  $("#login-pass").value = "";
}

async function onLogout() {
  if (state.role === "candidate" && dirtyAnswer) await saveAnswer();
  closeDrawer();
  await supabase.auth.signOut();
}

async function handleSession(session) {
  const user = session?.user ?? null;
  if (user && state.user?.id === user.id) return;
  state.user = user;
  state.role = null;
  clearInterval(tickTimer);
  clearTimeout(saveTimer);
  dirtyAnswer = false;
  if (!user) {
    state.candidates = [];
    state.evals = [];
    state.me = null;
    show("login-view");
    return;
  }
  $("#who").textContent = user.email?.startsWith("cand-") ? user.email.slice(5).split("@")[0] : user.email ?? "";
  show("app-view");
  try {
    const me = await api("GET", "/my");
    state.role = "candidate";
    state.me = me;
    setOffset(me.server_now);
    showPanel("candidate");
    renderCandidate();
    tickTimer = setInterval(tickCandidate, 1000);
  } catch (e) {
    if (e.status === 404 && !/not set up/i.test(e.message)) {
      state.role = "admin"; // not a candidate, and the admin checks passed
      showPanel("admin");
      await loadData();
      tickTimer = setInterval(() => {
        if (state.user && state.role === "admin") renderBoard();
      }, 60000);
    } else {
      handleError(e, "Could not load");
      if (e.status !== 401 && e.status !== 403) showDenied(e.message);
    }
  }
}

/* ---------- coding questions: run in a Web Worker with a time limit ---------- */
function runTests(code, fn, cases, ms = 3000) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker("worker.js");
    } catch {
      return resolve({ error: "Your browser could not start the test runner." });
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: "Timed out after 3 seconds. Is there an infinite loop?" });
    }, ms);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ error: e.message || "The test runner failed." });
    };
    worker.postMessage({ code, fn, cases });
  });
}

const show_ = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function resultsHtml(res, cases, labelHidden = false) {
  if (res.error) return `<p class="error" role="alert">${esc(res.error)}</p>`;
  const passed = res.results.filter((r) => r.ok).length;
  const rows = res.results
    .map((r, i) => {
      const c = cases[i];
      const hidden = labelHidden && c.hidden;
      return `<li class="${r.ok ? "pass" : "fail"}"><strong>${r.ok ? "Pass" : "Fail"}${hidden ? " (hidden case)" : ""}</strong>
        <span class="mono">${esc(c.args.map(show_).join(", "))}</span>
        ${r.ok ? "" : `<div class="small">Expected <span class="mono">${esc(show_(c.expected))}</span>, got <span class="mono">${esc(r.err ? "error: " + r.err : show_(r.got))}</span></div>`}</li>`;
    })
    .join("");
  return `<p class="testsum ${passed === res.results.length ? "allpass" : ""}">${passed} of ${res.results.length} tests passed</p><ul class="testlist">${rows}</ul>`;
}

/* =====================================================================
   CANDIDATE
   ===================================================================== */
function candidateRemaining() {
  return new Date(state.me.deadline).getTime() - now();
}

const LIMITS = { bugs: 25, ux: 10, roadmap: 10 };
const PREFIX = { bugs: "b", ux: "u", roadmap: "r" };
const NEEDED = { bugs: 8, ux: 5, roadmap: 10 };
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const LEVELS = ["High", "Medium", "Low"];
const fileUrls = new Map();
let uidN = 0;
const uid = (k) => `f-${k}-${++uidN}`;
const isImg = (f) => /^image\//.test(f.mime || "");

function ensureReport() {
  const r = (state.me.report ||= {});
  r.bugs ||= [{ id: "b1" }];
  r.ux ||= [1, 2, 3, 4, 5].map((n) => ({ id: "u" + n }));
  r.roadmap ||= [1, 2, 3].map((n) => ({ id: "r" + n }));
  return r;
}

const ro = () => (state.me.status === "running" ? "" : "readonly");
const bindTop = (f) => `data-f="${f}"`;
const bindItem = (list, id, f) => `data-f="${f}" data-list="${list}" data-id="${id}"`;

function taField(label, value, bind, rows = 3, hint = "") {
  const id = uid("t");
  return `<label for="${id}">${esc(label)}${hint ? ` <span class="muted small">(${esc(hint)})</span>` : ""}</label>
    <textarea id="${id}" class="rf" rows="${rows}" maxlength="20000" ${bind} ${ro()}>${esc(value)}</textarea>`;
}
function inField(label, value, bind, type = "text") {
  const id = uid("i");
  return `<label for="${id}">${esc(label)}</label><input id="${id}" class="rf" type="${type}" maxlength="${type === "url" ? 1000 : 300}" ${bind} value="${esc(value)}" ${ro()}>`;
}
function selField(label, value, bind, options) {
  const id = uid("s");
  return `<label for="${id}">${esc(label)}</label><select id="${id}" class="rf" ${bind} ${state.me.status === "running" ? "" : "disabled"}>
    <option value="">Choose</option>${options.map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}

function attachHtml(tag, label = "Screenshots and files") {
  const running = state.me.status === "running";
  const files = (state.me.files || []).filter((f) => (f.tag || "gen") === tag);
  const shots = files
    .filter(isImg)
    .map(
      (f) => `<figure class="shot"><a data-fid="${esc(f.id)}" target="_blank" rel="noopener"><img data-fid="${esc(f.id)}" alt="${esc(f.name)}"></a>
      <figcaption><span class="fname">${esc(f.name)}</span>${running ? `<button type="button" class="btn ghost small" data-act="file-del" data-id="${esc(f.id)}">Remove</button>` : ""}</figcaption></figure>`
    )
    .join("");
  const others = files
    .filter((f) => !isImg(f))
    .map(
      (f) => `<li><span class="fname">${esc(f.name)}</span><span class="muted small">${esc(fmtSize(f.size))}</span>
      ${running ? `<button type="button" class="btn ghost small" data-act="file-del" data-id="${esc(f.id)}">Remove</button>` : ""}</li>`
    )
    .join("");
  const input = uid("file");
  return `<div class="attach"><div class="attach-label small muted">${esc(label)}</div>
    ${shots ? `<div class="shots">${shots}</div>` : ""}${others ? `<ul class="filelist">${others}</ul>` : ""}
    ${running ? `<div class="actions"><label class="btn small" for="${input}">Add screenshots or files</label>
      <input id="${input}" type="file" multiple class="visually-hidden file-in"><span class="small muted">or paste an image here with Ctrl+V. Up to 10 MB each.</span></div>` : ""}
    ${!shots && !others && !running ? '<p class="muted small">Nothing attached.</p>' : ""}</div>`;
}

const itemHead = (title, list, id) => `<div class="item-head"><h3>${esc(title)}</h3>${
  state.me.status === "running" ? `<button type="button" class="btn ghost small" data-act="rm-item" data-list="${list}" data-id="${esc(id)}">Remove</button>` : ""}</div>`;

function bugItem(b, i) {
  const bd = (f) => bindItem("bugs", b.id, f);
  return `<div class="item" data-tag="${esc(b.id)}">${itemHead(`Bug B-${pad(i + 1)}`, "bugs", b.id)}
    <div class="grid2"><div>${inField("Title", b.title, bd("title"))}</div><div>${inField("Flow it belongs to", b.flow, bd("flow"))}</div></div>
    <div class="grid2"><div>${selField("Severity", b.severity, bd("severity"), SEVERITIES)}</div><div>${inField("Device and browser", b.device, bd("device"))}</div></div>
    ${taField("Steps to reproduce", b.steps, bd("steps"), 4)}
    <div class="grid2"><div>${taField("Expected", b.expected, bd("expected"), 3)}</div><div>${taField("Actual", b.actual, bd("actual"), 3)}</div></div>
    ${taField("Likely root cause", b.cause, bd("cause"), 3)}
    ${taField("Suggested fix", b.fix, bd("fix"), 3)}
    ${inField("Link to a screen recording (optional)", b.video, bd("video"), "url")}
    ${attachHtml(b.id, "Screenshots and evidence for this bug")}
  </div>`;
}

function uxItem(u, i) {
  const bd = (f) => bindItem("ux", u.id, f);
  return `<div class="item" data-tag="${esc(u.id)}">${itemHead(`UX problem ${i + 1}`, "ux", u.id)}
    ${inField("Title", u.title, bd("title"))}
    ${taField("What happens, with the evidence", u.evidence, bd("evidence"), 3)}
    ${taField("Who it hurts and why", u.hurts, bd("hurts"), 2)}
    ${taField("Your redesign", u.redesign, bd("redesign"), 3)}
    ${attachHtml(u.id, "Screenshot, annotated screenshot or mock")}
  </div>`;
}

function roadItem(x, i) {
  const bd = (f) => bindItem("roadmap", x.id, f);
  const cid = uid("c");
  return `<div class="item">${itemHead(`#${i + 1}`, "roadmap", x.id)}
    ${inField("Recommendation", x.rec, bd("rec"))}
    <div class="grid2"><div>${selField("Impact", x.impact, bd("impact"), LEVELS)}</div><div>${selField("Effort", x.effort, bd("effort"), LEVELS)}</div></div>
    ${taField("Why it is at this rank", x.why, bd("why"), 2)}
    ${inField("Metric that will show success", x.metric, bd("metric"))}
    <label class="check" for="${cid}"><input id="${cid}" type="checkbox" ${bd("first2")} ${x.first2 ? "checked" : ""} ${state.me.status === "running" ? "" : "disabled"}> One of my first three for the first two weeks</label>
  </div>`;
}

const filled = (o) => Object.entries(o).some(([k, v]) => k !== "id" && typeof v === "string" && v.trim());
function updateCounts() {
  const r = state.me.report || {};
  for (const list of ["bugs", "ux", "roadmap"]) {
    const el = document.querySelector(`[data-count="${list}"]`);
    if (!el) continue;
    const n = (r[list] || []).filter(filled).length;
    el.textContent = `${n} of ${NEEDED[list]}${list === "bugs" ? " needed" : list === "ux" ? " needed" : ""}`;
    el.classList.toggle("done", n >= NEEDED[list]);
  }
}

function setField(el) {
  const r = ensureReport();
  const val = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.list) {
    const item = (r[el.dataset.list] || []).find((x) => x.id === el.dataset.id);
    if (item) item[el.dataset.f] = val;
  } else r[el.dataset.f] = val;
}

async function fetchMyFile(id) {
  return api("GET", `/my/files/${id}`);
}

// Fills screenshot thumbnails. Images are fetched once and kept as object URLs.
async function loadImages(fetcher, root = document) {
  for (const img of root.querySelectorAll("img[data-fid]")) {
    const id = img.dataset.fid;
    if (!fileUrls.has(id)) {
      try {
        const f = await fetcher(id);
        const bin = atob(f.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        fileUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: f.mime || "image/jpeg" })));
      } catch {
        continue;
      }
    }
    img.src = fileUrls.get(id);
    const link = img.closest("a");
    if (link) link.href = fileUrls.get(id);
  }
}

function renderCandidate() {
  const scrollY = window.scrollY;
  if (state.me.status === "running") state.me.code = collectCode(); // keep unsaved typing across a redraw
  uidN = 0;
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
  const m = state.me;
  const root = $("#candidate-view");
  const first = esc(String(m.name || "").split(" ")[0]);
  const status = m.status;
  const brief = m.brief ? `<details class="brief card" open><summary>The assignment brief</summary><div class="prose">${m.brief}</div></details>` : "";

  if (status === "not_started") {
    root.innerHTML = `<div class="card cand-intro">
      <p class="eyebrow">Hiring assignment</p>
      <h1>Hi ${first}, your assignment is ready</h1>
      <p>You have <strong>${m.hours} hours</strong> to complete it, counted from the moment you press <strong>Start</strong>. The clock cannot be paused or restarted by you.</p>
      <ul class="plain">
        <li>The brief appears as soon as you press Start.</li>
        <li>Everything is done on this page: type your work, attach screenshots and files to each finding, and answer the coding questions. It all saves automatically.</li>
        <li>When the clock reaches zero, or when you press Submit final, everything is locked and nothing can be changed.</li>
        <li>Plan for about 7 to 9 focused hours. Take breaks and sleep.</li>
      </ul>
      <label class="check"><input id="ready" type="checkbox"> I am ready and I understand the clock starts now.</label>
      <div class="actions"><button class="btn primary" id="start-btn" type="button" disabled>Start the ${m.hours}-hour clock</button></div>
    </div>`;
    return;
  }

  const running = status === "running";
  const banner = running
    ? `<div class="clockbar" id="clockbar"><div><span class="small">Time left</span><div class="clocktext" id="clocktext">${clock(candidateRemaining())}</div></div>
         <div class="small" id="clocknote">Ends ${esc(fmtDate(m.deadline))}</div></div>`
    : `<div class="clockbar locked"><div><span class="small">Status</span><div class="clocktext">${status === "submitted" ? "Submitted" : "Time is up"}</div></div>
         <div class="small">${status === "submitted" ? `You submitted on ${esc(fmtDate(m.submitted_at))}.` : `The ${m.hours} hours ended ${esc(fmtDate(m.deadline))}.`} Everything is locked.</div></div>`;

  const questions = (m.questions || []).length
    ? `<div class="card"><h2>Coding questions</h2>
        <p class="muted small">Write each function, then press Run tests. These are sample tests; we also run hidden ones, so think about edge cases. Your code saves automatically. Only plain JavaScript functions, no imports.</p>
        ${m.questions
          .map(
            (q) => `<div class="question" data-q="${esc(q.id)}">
          <h3>${esc(q.title)}</h3>
          <p class="prompt">${q.prompt}</p>
          <label class="visually-hidden" for="code-${esc(q.id)}">Code for ${esc(q.title)}</label>
          <textarea id="code-${esc(q.id)}" class="code" data-code="${esc(q.id)}" spellcheck="false" autocapitalize="none" ${running ? "" : "readonly"}>${esc((m.code || {})[q.id] ?? q.starter)}</textarea>
          <div class="actions"><button class="btn" type="button" data-act="run" data-q="${esc(q.id)}">Run tests</button>
            <span class="small muted">${q.visible.length} sample tests</span></div>
          <div class="results" id="res-${esc(q.id)}" aria-live="polite"></div>
        </div>`
          )
          .join("")}
      </div>`
    : "";

  const r = ensureReport();
  const T = (label, key, rows, hint) => taField(label, r[key], bindTop(key), rows, hint);
  const bugs = r.bugs.map((x, i) => bugItem(x, i)).join("");
  const uxs = r.ux.map((x, i) => uxItem(x, i)).join("");
  const road = r.roadmap.map((x, i) => roadItem(x, i)).join("");
  const add = (list, label) => (running && r[list].length < LIMITS[list] ? `<div class="actions"><button class="btn" type="button" data-act="add-item" data-list="${list}">${label}</button></div>` : "");

  root.innerHTML = `${banner}
    ${brief}
    <div class="card" data-tag="p0">
      <h2>Part 0 · Map the product</h2>
      <p class="muted small">The flows you found, and the ones you could not reach and why. A short list is enough. You can attach a sketch or diagram.</p>
      ${T("Your map", "part0", 7)}
      ${attachHtml("p0")}
    </div>

    <div class="card">
      <h2>Part A · Bug hunt <span class="count" data-count="bugs"></span></h2>
      <p class="muted small">At least 8 real issues across at least 3 flows, with at least one deeper cause. Attach a screenshot to each (paste it with Ctrl+V while you are inside the bug).</p>
      ${bugs}${add("bugs", "Add another bug")}
    </div>

    <div class="card" data-tag="pb">
      <h2>Part B · UX audit <span class="count" data-count="ux"></span></h2>
      <p class="muted small">You are a shopkeeper in a small Indian town on a mid-range phone and patchy 4G.</p>
      ${T("The first five minutes: what confused you, where you hesitated or would have left", "ux_first5", 5)}
      <h3 class="subhead">Five specific UX problems</h3>
      ${uxs}${add("ux", "Add another UX problem")}
      ${T("Accessibility on one key page", "ux_a11y", 4, "keyboard, contrast, labels, touch targets, screen reader")}
      ${T("Clarity of the promise", "ux_promise", 4, "do “pay only for results” and “100 free credits” make sense, and when are credits used?")}
      ${attachHtml("pb", "Other Part B screenshots, sketches and mocks")}
    </div>

    <div class="card" data-tag="pc">
      <h2>Part C · Testing</h2>
      ${T("Test strategy", "test_strategy", 7, "top risks, what to test by hand, what to automate and why, what to monitor in production")}
      ${T("At least 10 test cases for one critical flow", "test_cases", 12, "ID, steps, expected result, edge cases")}
      ${T("Automated tests (bonus)", "test_auto", 5, "paste code or describe; you can attach files too")}
      ${attachHtml("pc")}
    </div>

    <div class="card" data-tag="pd">
      <h2>Part D · Fix or build one improvement</h2>
      <label for="${uid("fix_link")}">Link to your repo, prototype or patch</label>
      <input id="${uid("fix_link")}" class="rf" type="url" maxlength="1000" placeholder="https://" ${bindTop("fix_link")} value="${esc(r.fix_link)}" ${ro()}>
      ${T("Which finding, and what you changed and why", "fix_what", 6)}
      ${T("How you tested it", "fix_how", 4)}
      ${T("What could go wrong", "fix_risks", 4)}
      ${attachHtml("pd", "Patch files, before-and-after screenshots, Lighthouse reports")}
    </div>

    <div class="card">
      <h2>Part E · Roadmap <span class="count" data-count="roadmap"></span></h2>
      <p class="muted small">Your top 10 recommendations, in ranked order. Tick the 3 you would do in the first two weeks.</p>
      ${road}${add("roadmap", "Add another recommendation")}
      ${T("One thing you would deliberately not do, and why", "roadmap_not", 3)}
    </div>

    ${questions}

    <div class="card" data-tag="gen">
      <h2>Wrap-up</h2>
      ${T("Executive summary", "summary", 8, "half a page: your three most important findings")}
      ${T("Tools you used, including AI tools, and where you disagreed with them", "tools", 4)}
      <label for="${uid("link")}">Link to a full report or folder (optional)</label>
      <input id="${uid("link")}" class="rf" type="url" maxlength="1000" placeholder="https://" ${bindTop("link")} value="${esc(r.link)}" ${ro()}>
      ${attachHtml("gen", "Any other files (report PDF, spreadsheets, recordings)")}
      <div class="small muted" id="savestate">${running ? (m.answer_updated_at ? `Saved ${esc(fmtDate(m.answer_updated_at))}` : "Nothing saved yet") : ""}</div>
    </div>

    ${running ? `<div class="card"><h2>Finished early?</h2><p class="muted small">Submitting final locks everything straight away. You cannot undo it.</p>
      <div class="actions"><button class="btn danger" type="button" data-act="finish">Submit final</button></div></div>` : ""}`;
  updateCounts();
  loadImages(fetchMyFile);
}

function collectCode() {
  const out = { ...(state.me?.code || {}) };
  for (const ta of document.querySelectorAll("#candidate-view textarea.code")) out[ta.dataset.code] = ta.value;
  return out;
}

function tickCandidate() {
  if (state.role !== "candidate" || state.me?.status !== "running") return;
  const left = candidateRemaining();
  const t = $("#clocktext");
  const bar = $("#clockbar");
  if (t) t.textContent = clock(left);
  if (bar) {
    bar.classList.toggle("warn", left < 2 * HOUR && left >= 30 * 60000);
    bar.classList.toggle("bad", left < 30 * 60000);
  }
  if (left <= 0) refreshCandidate();
}

async function refreshCandidate() {
  if (dirtyAnswer) await saveAnswer();
  try {
    state.me = await api("GET", "/my");
    setOffset(state.me.server_now);
    renderCandidate();
  } catch (e) {
    handleError(e);
  }
}

async function saveAnswer() {
  if (state.role !== "candidate" || state.me?.status !== "running") return;
  clearTimeout(saveTimer);
  const note = $("#savestate");
  if (note) note.textContent = "Saving...";
  const codeNow = collectCode();
  const snapshot = JSON.stringify(state.me.report || {});
  try {
    await api("PUT", "/my/answer", { report: state.me.report || {}, code: codeNow });
    if (JSON.stringify(state.me.report || {}) === snapshot) dirtyAnswer = false;
    state.me.code = codeNow;
    const when = `Saved ${new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(now()))}`;
    const n = $("#savestate");
    if (n) n.textContent = when;
  } catch (e) {
    const n = $("#savestate");
    if (n) n.textContent = "Could not save. " + e.message;
    if (/locked|Time is up/i.test(e.message)) refreshCandidate();
  }
}

function queueSave() {
  dirtyAnswer = true;
  const note = $("#savestate");
  if (note) note.textContent = "Typing...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAnswer, 1500);
}

const readBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });

// Screenshots are shrunk in the browser (max 1800 px, JPEG) so they stay small and upload fast.
async function prepareFile(file) {
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 600 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

let uploading = false;
async function uploadFiles(fileList, tag = "gen") {
  if (uploading) return toast("Wait for the current upload to finish.", true);
  uploading = true;
  const files = [...fileList];
  try {
    for (const [i, original] of files.entries()) {
      if (original.size === 0) {
        toast(`${original.name || "That file"} is empty.`, true);
        continue;
      }
      if ((state.me.files || []).length >= MAX_FILES) {
        toast(`You can upload at most ${MAX_FILES} files.`, true);
        break;
      }
      const file = await prepareFile(original);
      if (file.size > MAX_FILE) {
        toast(`${file.name} is over 10 MB. Put it in a Drive folder and paste the link instead.`, true);
        continue;
      }
      const note = $("#savestate");
      if (note) note.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name || "image"}`;
      try {
        const data = await readBase64(file);
        const res = await api("POST", "/my/files", { name: file.name || "screenshot.png", mime: file.type || "application/octet-stream", tag, data });
        state.me.files = res.files;
        renderCandidate();
      } catch (e) {
        toast(e.message, true);
        if (/locked|Time is up/i.test(e.message)) return refreshCandidate();
      }
    }
  } finally {
    uploading = false;
    if (dirtyAnswer) saveAnswer();
    else {
      const n = $("#savestate");
      if (n && /^Uploading/.test(n.textContent)) n.textContent = "Uploaded.";
    }
  }
}

async function removeItem(list, id) {
  const r = ensureReport();
  const mine = (state.me.files || []).filter((f) => f.tag === id);
  const item = (r[list] || []).find((x) => x.id === id);
  if ((filled(item || {}) || mine.length) && !confirm("Remove this item and its attachments?")) return;
  for (const f of mine) {
    try {
      const res = await api("DELETE", `/my/files/${f.id}`);
      state.me.files = res.files;
    } catch (e) {
      return toast(e.message, true);
    }
  }
  r[list] = r[list].filter((x) => x.id !== id);
  renderCandidate();
  await saveAnswer();
}

function addItem(list) {
  const r = ensureReport();
  if (r[list].length >= LIMITS[list]) return;
  const n = Math.max(0, ...r[list].map((x) => Number(String(x.id).slice(1)) || 0)) + 1;
  r[list].push({ id: PREFIX[list] + n });
  renderCandidate();
  queueSave();
}

async function deleteMyFile(id) {
  try {
    const res = await api("DELETE", `/my/files/${id}`);
    state.me.files = res.files;
    renderCandidate();
  } catch (e) {
    toast(e.message, true);
    if (/locked|Time is up/i.test(e.message)) refreshCandidate();
  }
}

async function runQuestion(qid, btn) {
  const q = (state.me.questions || []).find((x) => x.id === qid);
  const ta = $(`#code-${qid}`);
  const out = $(`#res-${qid}`);
  if (!q || !ta || !out) return;
  btn.disabled = true;
  out.textContent = "Running...";
  const res = await runTests(ta.value, q.fn, q.visible);
  out.innerHTML = resultsHtml(res, q.visible);
  btn.disabled = false;
}

async function startAssignment() {
  const btn = $("#start-btn");
  btn.disabled = true;
  try {
    state.me = await api("POST", "/my/start");
    setOffset(state.me.server_now);
    renderCandidate();
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
  }
}

async function finishAssignment() {
  if (!confirm("Submit final? Your answer and files will be locked immediately and you cannot change them.")) return;
  await saveAnswer();
  try {
    state.me = await api("POST", "/my/finish");
    setOffset(state.me.server_now);
    renderCandidate();
    toast("Submitted. Thank you.");
  } catch (e) {
    toast(e.message, true);
  }
}

/* =====================================================================
   ADMIN
   ===================================================================== */
async function loadData() {
  try {
    const d = await api("GET", "/candidates");
    state.candidates = d.candidates || [];
    state.evals = d.reviews || [];
    setOffset(state.candidates[0]?.server_now);
    showPanel("admin");
    renderBoard();
  } catch (e) {
    handleError(e, "Could not load data");
  }
}

const assignStatus = (c) => {
  // The server decides; we only refine "running" into "time ended" when the clock has passed while the page was open.
  if (c.assignment_status === "running" && c.assignment_deadline && now() >= new Date(c.assignment_deadline).getTime()) return "closed";
  return c.assignment_status || "not_started";
};

function assignmentInfo(c) {
  const st = assignStatus(c);
  if (st === "not_started") return { tone: "", text: "Assigned, not started" };
  if (st === "running") {
    const left = new Date(c.assignment_deadline).getTime() - now();
    return { tone: left < 4 * HOUR ? "warn" : "", text: `Running, ${humanLeft(left)} left` };
  }
  if (st === "submitted") return { tone: "good", text: `Submitted ${fmtDate(c.assignment_submitted_at)}` };
  return { tone: "bad", text: `Time ended ${fmtDate(c.assignment_deadline)}` };
}

const reviewsFor = (id) => state.evals.filter((r) => String(r.candidate_id) === String(id));
const recChip = (rec) =>
  rec === "yes"
    ? '<span class="chip good">Yes</span>'
    : rec === "no"
      ? '<span class="chip bad">No</span>'
      : rec === "hold"
        ? '<span class="chip warn">Hold</span>'
        : "";

function renderStats() {
  const list = state.candidates;
  const active = list.filter((c) => !["hired", "rejected"].includes(c.stage));
  const tiles = [
    { n: active.length, l: "Active candidates" },
    { n: list.filter((c) => assignStatus(c) === "not_started" && c.stage === "assignment").length, l: "Yet to start assignment" },
    { n: list.filter((c) => assignStatus(c) === "running").length, l: "Working on it now" },
    { n: list.filter((c) => ["submitted", "closed"].includes(assignStatus(c)) && c.stage === "assignment").length, l: "Ready to review" },
    { n: list.filter((c) => c.stage === "offer").length, l: "Offers pending" },
  ];
  $("#stats").innerHTML = tiles
    .map((t) => `<div class="stat"><div class="num">${t.n}</div><div class="lbl">${esc(t.l)}</div></div>`)
    .join("");
}

function cardHtml(c) {
  const info = c.assignment_sent_at ? assignmentInfo(c) : null;
  const revs = reviewsFor(c.id);
  const chips = [];
  if (info) chips.push(`<span class="chip ${info.tone}">${esc(info.text)}</span>`);
  if (c.files_count > 0) chips.push(`<span class="chip">${c.files_count} file${c.files_count > 1 ? "s" : ""}</span>`);
  if (revs.length) chips.push(recChip(revs[0].recommendation));
  if (revs.length) chips.push(`<span class="chip">${revs.length} review${revs.length > 1 ? "s" : ""}</span>`);
  return `<button type="button" class="cand" data-open="${esc(c.id)}">
    <div class="name">${esc(c.name)}</div>
    <div class="sub">${esc(c.role)}${c.login_id ? " · ID " + esc(c.login_id) : ""}</div>
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
  </button>`;
}

function renderBoard() {
  const q = $("#search").value.trim().toLowerCase();
  const showRejected = $("#show-rejected").checked;
  const list = state.candidates.filter(
    (c) => !q || [c.name, c.email, c.role, c.notes, c.phone, c.login_id].some((v) => (v || "").toLowerCase().includes(q))
  );
  const cols = STAGES.filter((s) => s.key !== "rejected" || showRejected);
  $("#board").innerHTML = cols
    .map((s) => {
      const items = list.filter((c) => c.stage === s.key);
      return `<section class="col" data-stage="${esc(s.key)}" aria-label="${esc(s.label)}">
        <div class="col-head"><h2>${esc(s.label)}</h2><span class="count">${items.length}</span></div>
        ${items.length ? items.map(cardHtml).join("") : '<p class="col-empty">Nobody here.</p>'}
      </section>`;
    })
    .join("");
  $("#empty-hint").hidden = state.candidates.length > 0;
  renderStats();
}

/* ---------- drawer ---------- */
function stageOptions(selected, list = STAGES) {
  return list.map((s) => `<option value="${esc(s.key)}"${s.key === selected ? " selected" : ""}>${esc(s.label)}</option>`).join("");
}

const randomPassword = () => {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const body = [...bytes].map((b) => letters[b % letters.length]).join("");
  return `Ez${body}${(bytes[0] % 90) + 10}`;
};
const slugId = (name) => String(name || "").toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");

function reviewsHtml(c) {
  const revs = reviewsFor(c.id);
  const list = revs.length
    ? revs
        .map(
          (r) => `<div class="review">
        <div><strong>${esc(stageLabel(r.stage))}</strong>${r.score != null ? ` · Score ${esc(r.score)}` : ""} ${recChip(r.recommendation)}</div>
        ${r.feedback ? `<p>${esc(r.feedback)}</p>` : ""}
        <div class="meta">${esc(r.reviewer_name || "Unknown")} · ${esc(fmtDate(r.created_at))}
          <button type="button" class="btn ghost small" data-act="del-review" data-id="${esc(r.id)}">Remove</button></div>
      </div>`
        )
        .join("")
    : '<p class="muted small">No reviews yet.</p>';
  const defaultStage = REVIEW_STAGES.some((s) => s.key === c.stage) ? c.stage : "interview";
  return `<div class="drawer-section">
    <h3>Reviews</h3>
    ${list}
    <form data-form="review" novalidate>
      <div class="grid2">
        <div><label for="r-stage">Stage</label>
          <select id="r-stage" name="stage">${stageOptions(defaultStage, REVIEW_STAGES)}</select></div>
        <div><label for="r-score">Score</label>
          <input id="r-score" name="score" type="number" step="0.01" min="0" max="100" inputmode="decimal" placeholder="e.g. 3.2 or 78"></div>
      </div>
      <label for="r-rec">Recommendation</label>
      <select id="r-rec" name="recommendation">
        <option value="yes">Yes, move forward</option><option value="hold">Hold</option><option value="no">No</option>
      </select>
      <label for="r-fb">Feedback (specific and evidence-based)</label>
      <textarea id="r-fb" name="feedback" maxlength="5000" placeholder="Strengths, gaps, and what you saw."></textarea>
      <div class="actions"><button class="btn primary" type="submit">Add review</button></div>
    </form>
  </div>`;
}

function credentialsHtml(c) {
  const jc = state.justCreated && String(state.justCreated.id) === String(c.id) ? state.justCreated : null;
  const link = `${location.origin}/employmenthiringassignment/`;
  return `<div class="drawer-section">
    <h3>Candidate login</h3>
    ${
      jc
        ? `<div class="creds" role="status"><p class="small"><strong>Send these to ${esc(c.name)} now.</strong> The password is not shown again.</p>
           <p class="mono">Link: ${esc(link)}<br>User ID: ${esc(jc.login_id)}<br>Password: ${esc(jc.password)}</p>
           <button class="btn small" type="button" data-act="copy-creds">Copy login details</button></div>`
        : `<p class="small muted">User ID: <strong>${esc(c.login_id || "none yet")}</strong>. Passwords are never shown after the first time; set a new one if it is lost.</p>`
    }
    <form data-form="login" novalidate>
      ${c.login_id ? "" : `<label for="l-id">User ID</label><input id="l-id" name="login_id" type="text" maxlength="30" autocomplete="off" value="${esc(slugId(c.name))}">`}
      <label for="l-pw">${c.login_id ? "New password" : "Password"}</label>
      <div class="inline"><input id="l-pw" name="password" type="text" maxlength="72" autocomplete="off" value="${esc(randomPassword())}">
        <button class="btn" type="submit">${c.login_id ? "Set password" : "Create login"}</button></div>
    </form>
  </div>`;
}

function assignmentHtml(c) {
  const info = assignmentInfo(c);
  return `<div class="drawer-section">
    <h3>24-hour assignment</h3>
    <div class="timer ${info.tone}" id="asg-timer">${esc(info.text)}</div>
    ${c.assignment_started_at ? `<p class="muted small">Started ${esc(fmtDate(c.assignment_started_at))}. Ends ${esc(fmtDate(c.assignment_deadline))}.</p>` : '<p class="muted small">The clock starts when the candidate signs in and presses Start.</p>'}
    <div id="sub-box"><p class="muted small">Loading submission...</p></div>
    ${c.assignment_started_at ? '<div class="actions"><button class="btn ghost" type="button" data-act="asg-reset">Reset the clock</button></div><p class="muted small">Reset only after a technical problem. The candidate\'s answer and files are kept; the clock restarts when they press Start again.</p>' : ""}
  </div>`;
}

function openDrawer(id) {
  const c = id ? state.candidates.find((x) => String(x.id) === String(id)) : null;
  if (id && !c) return;
  const drawer = $("#drawer");
  const prevScroll = String(state.openId) === String(id) && $(".drawer-body", drawer) ? $(".drawer-body", drawer).scrollTop : 0;
  state.openId = id || null;
  const v = c || { name: "", email: "", phone: "", role: "Full Stack Developer", stage: "applied", resume_url: "", notes: "" };
  drawer.innerHTML = `<div class="drawer-inner">
    <div class="drawer-head">
      <h2 id="drawer-title">${c ? esc(c.name) : "Add candidate"}</h2>
      <button class="btn ghost" type="button" data-act="close">Close</button>
    </div>
    <div class="drawer-body">
      <div class="drawer-section">
        <form data-form="candidate" novalidate>
          <label for="f-name">Full name</label>
          <input id="f-name" name="name" type="text" maxlength="200" value="${esc(v.name)}" required autocomplete="off">
          <div class="grid2">
            <div><label for="f-email">Email</label><input id="f-email" name="email" type="email" maxlength="254" value="${esc(v.email)}" autocomplete="off"></div>
            <div><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" maxlength="40" value="${esc(v.phone)}" autocomplete="off"></div>
          </div>
          <div class="grid2">
            <div><label for="f-role">Role</label><input id="f-role" name="role" type="text" maxlength="120" value="${esc(v.role)}"></div>
            ${c ? `<div><label for="f-stage">Stage</label><select id="f-stage" name="stage">${stageOptions(v.stage)}</select></div>` : ""}
          </div>
          <label for="f-resume">Resume link (https://...)</label>
          <input id="f-resume" name="resume_url" type="url" maxlength="1000" value="${esc(v.resume_url)}" placeholder="https://">
          ${c && isHttpUrl(c.resume_url) ? `<p class="small"><a href="${esc(c.resume_url)}" target="_blank" rel="noopener noreferrer">Open resume</a></p>` : ""}
          <label for="f-notes">Notes</label>
          <textarea id="f-notes" name="notes" maxlength="5000">${esc(v.notes)}</textarea>
          ${
            c
              ? ""
              : `<div class="creds-new"><h3>Candidate login</h3>
            <p class="small muted">The candidate signs in with this and the 24-hour assignment is assigned straight away. The clock starts only when they press Start.</p>
            <div class="grid2">
              <div><label for="f-login">User ID</label><input id="f-login" name="login_id" type="text" maxlength="30" autocomplete="off"></div>
              <div><label for="f-pw">Password</label><input id="f-pw" name="password" type="text" maxlength="72" autocomplete="off" value="${esc(randomPassword())}"></div>
            </div></div>`
          }
          <div class="actions">
            <button class="btn primary" type="submit">${c ? "Save changes" : "Add candidate and assign"}</button>
            ${c ? '<span class="spacer"></span><button class="btn danger" type="button" data-act="delete">Delete</button>' : ""}
          </div>
        </form>
      </div>
      ${c ? credentialsHtml(c) + assignmentHtml(c) + reviewsHtml(c) : ""}
    </div>
  </div>`;
  if (!drawer.open) drawer.showModal();
  const body = $(".drawer-body", drawer);
  if (body && prevScroll) body.scrollTop = prevScroll;
  if (!c) {
    $("#f-name", drawer).focus();
    $("#f-name", drawer).addEventListener("input", () => {
      const l = $("#f-login", drawer);
      if (l && !l.dataset.touched) l.value = slugId($("#f-name", drawer).value);
    });
    $("#f-login", drawer).addEventListener("input", (e) => (e.target.dataset.touched = "1"));
  } else {
    loadSubmission(c.id);
  }
}

async function loadSubmission(id) {
  try {
    const s = await api("GET", `/candidates/${id}/submission`);
    if (String(state.openId) !== String(id)) return;
    const box = $("#sub-box");
    if (!box) return;
    const files = (s.files || [])
      .map(
        (f) => `<li><span class="fname">${esc(f.name)}</span><span class="muted small">${esc(fmtSize(f.size))}</span>
        <button type="button" class="btn small" data-act="file-get" data-id="${esc(f.id)}" data-name="${esc(f.name)}">Download</button></li>`
      )
      .join("");
    box.innerHTML = `<h4>Report${s.answer_updated_at ? ` <span class="muted small">(saved ${esc(fmtDate(s.answer_updated_at))})</span>` : ""}</h4>
      ${reportViewHtml(s.report || {}, s.files || [], s.answer)}
      <h4>All files</h4>
      <ul class="filelist">${files || '<li class="muted small">No files uploaded.</li>'}</ul>
      <h4>Coding questions</h4>
      ${
        (s.questions || [])
          .map((q) => {
            const code = (s.code || {})[q.id];
            return `<details class="question-admin" data-q="${esc(q.id)}"><summary>${esc(q.title)} ${code && code.trim() !== q.starter.trim() ? "" : '<span class="muted small">(not attempted)</span>'}</summary>
              <pre class="codeview">${esc(code ?? "(no code saved)")}</pre>
              <button class="btn small" type="button" data-act="admin-run" data-q="${esc(q.id)}">Run all tests (sample + hidden)</button>
              <div class="results" id="ares-${esc(q.id)}"></div></details>`;
          })
          .join("") || '<p class="muted small">No coding questions loaded.</p>'
      }`;
    subCtx = { id, questions: s.questions || [], code: s.code || {} };
    loadImages((fid) => api("GET", `/files/${fid}`), box);
  } catch (e) {
    const box = $("#sub-box");
    if (box) box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

/* ---------- admin: read-only view of a candidate's report ---------- */
function reportViewHtml(r, files, legacyAnswer) {
  const att = (tag) => {
    const mine = files.filter((f) => (f.tag || "gen") === tag);
    if (!mine.length) return "";
    const shots = mine.filter(isImg).map((f) => `<figure class="shot"><a data-fid="${esc(f.id)}" target="_blank" rel="noopener"><img data-fid="${esc(f.id)}" alt="${esc(f.name)}"></a><figcaption class="fname">${esc(f.name)}</figcaption></figure>`).join("");
    const rest = mine.filter((f) => !isImg(f)).map((f) => `<li><span class="fname">${esc(f.name)}</span> <button type="button" class="btn small" data-act="file-get" data-id="${esc(f.id)}" data-name="${esc(f.name)}">Download</button></li>`).join("");
    return `${shots ? `<div class="shots">${shots}</div>` : ""}${rest ? `<ul class="filelist">${rest}</ul>` : ""}`;
  };
  const txt = (label, v) => (v && String(v).trim() ? `<div class="rv-field"><div class="rv-label">${esc(label)}</div><div class="answer-view">${esc(v)}</div></div>` : "");
  const line = (label, v) => (v && String(v).trim() ? `<div class="rv-line"><span class="rv-label">${esc(label)}</span> ${esc(v)}</div>` : "");
  const link = (label, v) => (isHttpUrl(v) ? `<div class="rv-line"><span class="rv-label">${esc(label)}</span> <a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a></div>` : "");
  const sec = (title, inner) => `<details class="rv" open><summary>${esc(title)}</summary>${inner || '<p class="muted small">Nothing written.</p>'}</details>`;
  const used = (list) => (list || []).filter((x) => filled(x) || files.some((f) => f.tag === x.id));

  const bugs = used(r.bugs).map((b, i) => `<div class="rv-item"><strong>B-${pad(i + 1)} ${esc(b.title || "(no title)")}</strong>
    ${b.severity ? `<span class="chip ${b.severity === "Critical" || b.severity === "High" ? "bad" : b.severity === "Medium" ? "warn" : ""}">${esc(b.severity)}</span>` : ""}
    ${line("Flow", b.flow)}${line("Device", b.device)}${txt("Steps", b.steps)}${txt("Expected", b.expected)}${txt("Actual", b.actual)}${txt("Likely cause", b.cause)}${txt("Suggested fix", b.fix)}${link("Recording", b.video)}${att(b.id)}</div>`).join("");
  const ux = used(r.ux).map((u, i) => `<div class="rv-item"><strong>UX ${i + 1} ${esc(u.title || "(no title)")}</strong>
    ${txt("Evidence", u.evidence)}${txt("Who it hurts", u.hurts)}${txt("Redesign", u.redesign)}${att(u.id)}</div>`).join("");
  const road = used(r.roadmap).map((x, i) => `<div class="rv-item"><strong>#${i + 1} ${esc(x.rec || "(empty)")}</strong>
    ${x.impact ? `<span class="chip">Impact ${esc(x.impact)}</span>` : ""}${x.effort ? `<span class="chip">Effort ${esc(x.effort)}</span>` : ""}${x.first2 ? '<span class="chip good">First 2 weeks</span>' : ""}
    ${txt("Why this rank", x.why)}${line("Metric", x.metric)}</div>`).join("");

  return [
    sec("Wrap-up: summary and tools", txt("Executive summary", r.summary) + txt("Tools used", r.tools) + link("Link", r.link) + att("gen") + (legacyAnswer ? txt("Earlier answer box", legacyAnswer) : "")),
    sec(`Part A · Bugs (${used(r.bugs).length})`, bugs),
    sec(`Part B · UX audit (${used(r.ux).length} problems)`, txt("First five minutes", r.ux_first5) + ux + txt("Accessibility", r.ux_a11y) + txt("Clarity of the promise", r.ux_promise) + att("pb")),
    sec("Part C · Testing", txt("Strategy", r.test_strategy) + txt("Test cases", r.test_cases) + txt("Automated tests", r.test_auto) + att("pc")),
    sec("Part D · Fix or improvement", link("Repo or prototype", r.fix_link) + txt("What and why", r.fix_what) + txt("How tested", r.fix_how) + txt("What could go wrong", r.fix_risks) + att("pd")),
    sec(`Part E · Roadmap (${used(r.roadmap).length})`, road + txt("Would not do", r.roadmap_not)),
    sec("Part 0 · Product map", txt("Map", r.part0) + att("p0")),
  ].join("");
}

async function adminRun(qid, btn) {
  if (!subCtx) return;
  const q = subCtx.questions.find((x) => x.id === qid);
  const out = $(`#ares-${qid}`);
  if (!q || !out) return;
  const code = subCtx.code[qid];
  if (!code || !code.trim()) {
    out.innerHTML = '<p class="muted small">No code to run.</p>';
    return;
  }
  const cases = [...q.visible, ...(q.hidden || []).map((h) => ({ ...h, hidden: true }))];
  btn.disabled = true;
  out.textContent = "Running...";
  const res = await runTests(code, q.fn, cases);
  out.innerHTML = resultsHtml(res, cases, true);
  btn.disabled = false;
}

async function downloadFile(id, fallbackName) {
  try {
    const f = await api("GET", `/files/${id}`);
    const bin = atob(f.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name || fallbackName || "file";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    toast(e.message, true);
  }
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (drawer.open) drawer.close();
  state.openId = null;
}

/* ---------- admin mutations ---------- */
async function run(call, okMessage) {
  try {
    const out = await call();
    if (okMessage) toast(okMessage);
    return { ok: true, out };
  } catch (e) {
    handleError(e);
    return { ok: false };
  }
}

async function saveCandidate(form) {
  const f = new FormData(form);
  const name = String(f.get("name") || "").trim();
  if (!name) return toast("Name is required.", true);
  const resume = clean(f.get("resume_url"));
  if (resume && !isHttpUrl(resume)) return toast("Resume link must start with http:// or https://", true);
  const payload = {
    name,
    email: clean(f.get("email")),
    phone: clean(f.get("phone")),
    role: clean(f.get("role")) || "Full Stack Developer",
    stage: f.get("stage") || undefined,
    resume_url: resume,
    notes: clean(f.get("notes")),
  };
  const id = state.openId;
  if (id) {
    const r = await run(() => api("PATCH", `/candidates/${id}`, payload), "Saved");
    if (!r.ok) return;
    await loadData();
    return openDrawer(id);
  }
  payload.login_id = String(f.get("login_id") || "").trim();
  payload.password = String(f.get("password") || "");
  if (!payload.login_id) return toast("Choose a User ID for the candidate.", true);
  const r = await run(() => api("POST", "/candidates", payload), "Candidate added and assigned");
  if (!r.ok) return;
  state.justCreated = { id: r.out.id, login_id: r.out.login_id, password: payload.password };
  await loadData();
  openDrawer(r.out.id);
}

async function saveLogin(form) {
  const id = state.openId;
  const c = state.candidates.find((x) => String(x.id) === String(id));
  if (!c) return;
  const f = new FormData(form);
  const password = String(f.get("password") || "");
  const login_id = String(f.get("login_id") || c.login_id || "").trim();
  const r = await run(() => api("POST", `/candidates/${id}/login`, { login_id, password }), c.login_id ? "Password updated" : "Login created");
  if (!r.ok) return;
  state.justCreated = { id: c.id, login_id: r.out.login_id || login_id, password };
  await loadData();
  openDrawer(id);
}

async function resetClock() {
  const id = state.openId;
  if (!confirm("Reset this candidate's clock? They will need to press Start again. Their answer and files are kept.")) return;
  if (!(await run(() => api("POST", `/candidates/${id}/assignment`, { action: "reset" }), "Clock reset")).ok) return;
  await loadData();
  openDrawer(id);
}

async function addReview(form) {
  const f = new FormData(form);
  const raw = String(f.get("score") || "").trim();
  const score = raw === "" ? null : Number(raw);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) return toast("Score must be between 0 and 100.", true);
  const payload = {
    stage: f.get("stage"),
    score: score === null ? null : String(score),
    recommendation: f.get("recommendation"),
    feedback: clean(f.get("feedback")),
  };
  const id = state.openId;
  if (!(await run(() => api("POST", `/candidates/${id}/reviews`, payload), "Review added")).ok) return;
  await loadData();
  openDrawer(id);
}

async function deleteReview(rid) {
  if (!confirm("Remove this review?")) return;
  const id = state.openId;
  if (!(await run(() => api("DELETE", `/reviews/${rid}`), "Review removed")).ok) return;
  await loadData();
  openDrawer(id);
}

async function deleteCandidate() {
  const c = state.candidates.find((x) => String(x.id) === String(state.openId));
  if (!c || !confirm(`Delete ${c.name}, their login, files and all reviews? This cannot be undone.`)) return;
  if (!(await run(() => api("DELETE", `/candidates/${c.id}`), "Candidate deleted")).ok) return;
  closeDrawer();
  await loadData();
}

async function copyCreds() {
  const jc = state.justCreated;
  if (!jc) return;
  const text = `Hiring assignment\nLink: ${location.origin}/employmenthiringassignment/\nUser ID: ${jc.login_id}\nPassword: ${jc.password}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Could not copy. Select the text and copy it.", true);
  }
}

/* ---------- wiring ---------- */
function wire() {
  $("#login-form").addEventListener("submit", onLogin);
  $("#logout-btn").addEventListener("click", onLogout);
  $("#add-btn").addEventListener("click", () => openDrawer(null));
  $("#search").addEventListener("input", renderBoard);
  $("#show-rejected").addEventListener("change", renderBoard);

  $("#board").addEventListener("click", (e) => {
    const card = e.target.closest("[data-open]");
    if (card) openDrawer(card.dataset.open);
  });

  const cand = $("#candidate-view");
  cand.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "ready") $("#start-btn").disabled = !t.checked;
    if (t.classList?.contains("file-in")) {
      const tag = t.closest("[data-tag]")?.dataset.tag || "gen";
      uploadFiles(t.files, tag);
      t.value = "";
    } else if (t.dataset?.f && (t.tagName === "SELECT" || t.type === "checkbox")) {
      setField(t);
      updateCounts();
      queueSave();
    }
  });
  cand.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches?.("textarea.code")) return queueSave();
    if (t.dataset?.f && t.tagName !== "SELECT" && t.type !== "checkbox") {
      setField(t);
      updateCounts();
      queueSave();
    }
  });
  cand.addEventListener("focusout", (e) => {
    if ((e.target.matches?.(".rf") || e.target.matches?.("textarea.code")) && dirtyAnswer) saveAnswer();
  });
  cand.addEventListener("paste", (e) => {
    if (state.me?.status !== "running") return;
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    e.preventDefault();
    const tag = e.target.closest("[data-tag]")?.dataset.tag || "gen";
    uploadFiles(imgs, tag);
  });
  cand.addEventListener("click", (e) => {
    if (e.target.id === "start-btn") return startAssignment();
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "run") runQuestion(btn.dataset.q, btn);
    else if (btn.dataset.act === "file-del") deleteMyFile(btn.dataset.id);
    else if (btn.dataset.act === "finish") finishAssignment();
    else if (btn.dataset.act === "add-item") addItem(btn.dataset.list);
    else if (btn.dataset.act === "rm-item") removeItem(btn.dataset.list, btn.dataset.id);
  });

  const drawer = $("#drawer");
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) return closeDrawer(); // click on the backdrop
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") closeDrawer();
    else if (act === "delete") deleteCandidate();
    else if (act === "del-review") deleteReview(btn.dataset.id);
    else if (act === "asg-reset") resetClock();
    else if (act === "file-get") downloadFile(btn.dataset.id, btn.dataset.name);
    else if (act === "copy-creds") copyCreds();
    else if (act === "admin-run") adminRun(btn.dataset.q, btn);
  });
  drawer.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target.closest("[data-form]");
    if (!form) return;
    if (form.dataset.form === "candidate") saveCandidate(form);
    else if (form.dataset.form === "review") addReview(form);
    else if (form.dataset.form === "login") saveLogin(form);
  });
  drawer.addEventListener("close", () => (state.openId = null));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.user) return;
    if (state.role === "admin" && !drawer.open) loadData();
    if (state.role === "candidate") refreshCandidate();
  });
}

async function boot() {
  // Own storage key: a candidate signing in here never touches the work tracker's session.
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: "ezy-hiring-auth" } });
  wire();
  supabase.auth.onAuthStateChange((_event, session) => {
    // Defer: calling Supabase from inside this callback can deadlock.
    setTimeout(() => handleSession(session), 0);
  });
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
}

boot();
