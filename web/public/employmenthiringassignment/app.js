import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
  { key: "interview", label: "Interview", hint: "Weighted score out of 4" },
  { key: "assignment", label: "Assignment", hint: "Score out of 100" },
  { key: "office", label: "Office round", hint: "Score out of 4" },
];
const ASSIGNMENT_HOURS = 24;
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
const duration = (ms) => {
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const isHttpUrl = (u) => /^https?:\/\//i.test(u || "");

const state = { user: null, candidates: [], evals: [], openId: null };
let supabase = null;
let tickTimer = null;
let toastTimer = null;

/* ---------- views ---------- */
function show(view) {
  for (const id of ["login-view", "app-view"]) $("#" + id).hidden = id !== view;
}

function showDenied(message) {
  $("#denied-msg").textContent = message;
  $("#denied").hidden = false;
  $("#content").hidden = true;
}

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 2800);
}

/* ---------- auth ---------- */
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

async function onLogin(event) {
  event.preventDefault();
  const id = $("#login-id").value;
  const password = $("#login-pass").value;
  const err = $("#login-error");
  err.hidden = true;
  if (!id.trim() || !password) {
    err.textContent = "Enter your email and password.";
    err.hidden = false;
    return;
  }
  const btn = $("#login-btn");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  const { error } = await supabase.auth.signInWithPassword({ email: id.trim(), password });
  btn.disabled = false;
  btn.textContent = "Sign in";
  if (error) {
    err.textContent = /confirm/i.test(error.message)
      ? "This account is not confirmed yet. Ask an admin to confirm it."
      : "Wrong email or password.";
    err.hidden = false;
    return;
  }
  $("#login-pass").value = "";
}

async function onLogout() {
  closeDrawer();
  await supabase.auth.signOut();
}

async function handleSession(session) {
  const user = session?.user ?? null;
  if (user && state.user?.id === user.id) return;
  state.user = user;
  clearInterval(tickTimer);
  if (!user) {
    state.candidates = [];
    state.evals = [];
    show("login-view");
    return;
  }
  $("#who").textContent = user.email ?? "";
  $("#denied").hidden = true;
  $("#content").hidden = false;
  show("app-view");
  await loadData();
  tickTimer = setInterval(() => {
    if (state.user) renderBoard();
  }, 60000);
}

/* ---------- data ---------- */
async function loadData() {
  try {
    const d = await api("GET", "/candidates");
    state.candidates = d.candidates || [];
    state.evals = d.reviews || [];
    $("#denied").hidden = true;
    $("#content").hidden = false;
    renderBoard();
  } catch (e) {
    handleError(e, "Could not load data");
  }
}

function handleError(e, prefix) {
  if (e.status === 401) {
    supabase.auth.signOut();
    return;
  }
  if (e.status === 403 || /has no account here/i.test(e.message)) {
    closeDrawer();
    showDenied(e.message);
    return;
  }
  toast(prefix ? `${prefix}: ${e.message}` : e.message, true);
}

/* ---------- helpers ---------- */
function assignmentInfo(c) {
  if (!c.assignment_sent_at) return null;
  const sent = new Date(c.assignment_sent_at).getTime();
  const due = sent + ASSIGNMENT_HOURS * HOUR;
  if (c.assignment_submitted_at) {
    const late = new Date(c.assignment_submitted_at).getTime() > due;
    return { tone: late ? "warn" : "good", text: `Submitted ${late ? "late " : ""}${fmtDate(c.assignment_submitted_at)}` };
  }
  const diff = due - Date.now();
  if (diff > 0) return { tone: diff < 4 * HOUR ? "warn" : "", text: `Due in ${duration(diff)}` };
  return { tone: "bad", text: `Overdue by ${duration(-diff)}` };
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

/* ---------- board ---------- */
function renderStats() {
  const active = state.candidates.filter((c) => !["hired", "rejected"].includes(c.stage));
  const out = state.candidates.filter((c) => c.assignment_sent_at && !c.assignment_submitted_at);
  const overdue = out.filter((c) => new Date(c.assignment_sent_at).getTime() + ASSIGNMENT_HOURS * HOUR < Date.now());
  const tiles = [
    { n: active.length, l: "Active candidates" },
    { n: state.candidates.filter((c) => c.stage === "interview").length, l: "In interview" },
    { n: out.length, l: "Assignments out" },
    { n: overdue.length, l: "Assignments overdue", alert: overdue.length > 0 },
    { n: state.candidates.filter((c) => c.stage === "offer").length, l: "Offers pending" },
  ];
  $("#stats").innerHTML = tiles
    .map((t) => `<div class="stat${t.alert ? " alert" : ""}"><div class="num">${t.n}</div><div class="lbl">${esc(t.l)}</div></div>`)
    .join("");
}

function cardHtml(c) {
  const info = c.stage === "assignment" || c.assignment_sent_at ? assignmentInfo(c) : null;
  const revs = reviewsFor(c.id);
  const chips = [];
  if (info) chips.push(`<span class="chip ${info.tone}">${esc(info.text)}</span>`);
  if (revs.length) chips.push(recChip(revs[0].recommendation));
  if (revs.length) chips.push(`<span class="chip">${revs.length} review${revs.length > 1 ? "s" : ""}</span>`);
  return `<button type="button" class="cand" data-open="${esc(c.id)}">
    <div class="name">${esc(c.name)}</div>
    <div class="sub">${esc(c.role)}${c.email ? " · " + esc(c.email) : ""}</div>
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
  </button>`;
}

function renderBoard() {
  const q = $("#search").value.trim().toLowerCase();
  const showRejected = $("#show-rejected").checked;
  const list = state.candidates.filter(
    (c) => !q || [c.name, c.email, c.role, c.notes, c.phone].some((v) => (v || "").toLowerCase().includes(q))
  );
  const cols = STAGES.filter((s) => s.key !== "rejected" || showRejected);
  $("#board").innerHTML = cols
    .map((s) => {
      const items = list.filter((c) => c.stage === s.key);
      return `<section class="col" aria-label="${esc(s.label)}">
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

function assignmentHtml(c) {
  const info = assignmentInfo(c);
  return `<div class="drawer-section">
    <h3>24-hour assignment</h3>
    ${
      info
        ? `<div class="timer ${info.tone}">${esc(info.text)}</div>
           <p class="muted small">Sent ${esc(fmtDate(c.assignment_sent_at))}</p>`
        : '<p class="muted small">Not sent yet. Marking it sent starts the 24-hour clock and moves the candidate to Assignment.</p>'
    }
    <div class="actions">
      ${!c.assignment_sent_at ? '<button class="btn" type="button" data-act="asg-sent">Mark sent now</button>' : ""}
      ${c.assignment_sent_at && !c.assignment_submitted_at ? '<button class="btn" type="button" data-act="asg-submitted">Mark submitted now</button>' : ""}
      ${c.assignment_sent_at ? '<button class="btn ghost" type="button" data-act="asg-reset">Reset</button>' : ""}
    </div>
  </div>`;
}

function openDrawer(id) {
  const c = id ? state.candidates.find((x) => String(x.id) === String(id)) : null;
  if (id && !c) return;
  const drawer = $("#drawer");
  const prevScroll = state.openId === id && $(".drawer-body", drawer) ? $(".drawer-body", drawer).scrollTop : 0;
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
            <div><label for="f-stage">Stage</label><select id="f-stage" name="stage">${stageOptions(v.stage)}</select></div>
          </div>
          <label for="f-resume">Resume link (https://...)</label>
          <input id="f-resume" name="resume_url" type="url" maxlength="1000" value="${esc(v.resume_url)}" placeholder="https://">
          ${c && isHttpUrl(c.resume_url) ? `<p class="small"><a href="${esc(c.resume_url)}" target="_blank" rel="noopener noreferrer">Open resume</a></p>` : ""}
          <label for="f-notes">Notes</label>
          <textarea id="f-notes" name="notes" maxlength="5000">${esc(v.notes)}</textarea>
          <div class="actions">
            <button class="btn primary" type="submit">${c ? "Save changes" : "Add candidate"}</button>
            ${c ? '<span class="spacer"></span><button class="btn danger" type="button" data-act="delete">Delete</button>' : ""}
          </div>
        </form>
      </div>
      ${c ? assignmentHtml(c) + reviewsHtml(c) : ""}
    </div>
  </div>`;
  if (!drawer.open) drawer.showModal();
  const body = $(".drawer-body", drawer);
  if (body && prevScroll) body.scrollTop = prevScroll;
  if (!c) $("#f-name", drawer).focus();
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (drawer.open) drawer.close();
  state.openId = null;
}

/* ---------- mutations ---------- */
async function run(call, okMessage) {
  try {
    await call();
    if (okMessage) toast(okMessage);
    return true;
  } catch (e) {
    handleError(e);
    return false;
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
    stage: f.get("stage"),
    resume_url: resume,
    notes: clean(f.get("notes")),
  };
  const id = state.openId;
  const ok = id
    ? await run(() => api("PATCH", `/candidates/${id}`, payload), "Saved")
    : await run(() => api("POST", "/candidates", payload), "Candidate added");
  if (!ok) return;
  await loadData();
  if (id) openDrawer(id);
  else closeDrawer();
}

async function assignmentAction(kind) {
  const id = state.openId;
  if (!id) return;
  const action = { "asg-sent": "sent", "asg-submitted": "submitted", "asg-reset": "reset" }[kind];
  if (!action) return;
  if (!(await run(() => api("POST", `/candidates/${id}/assignment`, { action })))) return;
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
  if (!(await run(() => api("POST", `/candidates/${id}/reviews`, payload), "Review added"))) return;
  await loadData();
  openDrawer(id);
}

async function deleteReview(rid) {
  if (!confirm("Remove this review?")) return;
  const id = state.openId;
  if (!(await run(() => api("DELETE", `/reviews/${rid}`), "Review removed"))) return;
  await loadData();
  openDrawer(id);
}

async function deleteCandidate() {
  const c = state.candidates.find((x) => String(x.id) === String(state.openId));
  if (!c || !confirm(`Delete ${c.name} and all their reviews? This cannot be undone.`)) return;
  if (!(await run(() => api("DELETE", `/candidates/${c.id}`), "Candidate deleted"))) return;
  closeDrawer();
  await loadData();
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

  const drawer = $("#drawer");
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) return closeDrawer(); // click on the backdrop
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") closeDrawer();
    else if (act === "delete") deleteCandidate();
    else if (act === "del-review") deleteReview(btn.dataset.id);
    else if (act.startsWith("asg-")) assignmentAction(act);
  });
  drawer.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target.closest("[data-form]");
    if (!form) return;
    if (form.dataset.form === "candidate") saveCandidate(form);
    else if (form.dataset.form === "review") addReview(form);
  });
  drawer.addEventListener("close", () => (state.openId = null));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.user && !drawer.open) loadData();
  });
}

async function boot() {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  wire();
  supabase.auth.onAuthStateChange((_event, session) => {
    // Defer: calling Supabase from inside this callback can deadlock.
    setTimeout(() => handleSession(session), 0);
  });
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
}

boot();
