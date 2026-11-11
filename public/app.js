/* Wedding tracker – one app, many weddings.
   Data lives in Supabase; see supabase/migrations for the schema and access rules. */
"use strict";

const CFG = window.APP_CONFIG || {};
const STATUSES = ["Not started", "In progress", "Done"];
const ACTION_SECTION = "Meeting actions";
const LAST_WEDDING_KEY = "weddingTracker.lastWedding";

const S = {
  session: null, email: "", isAppAdmin: false,
  weddings: [], myRoles: {},            // wedding_id -> role
  wedding: null, role: null,
  committees: [], members: [], tasks: [], meetings: [], updates: [], food: [],
};
const ui = { taskFilter: { committee: "", status: "open", q: "" } };

const app = document.getElementById("app");
const dlg = document.getElementById("dlg");
const dlgForm = document.getElementById("dlgForm");
const $ = id => document.getElementById(id);

if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) {
  app.innerHTML = `<div class="signin card"><h2>The app isn't connected to its database yet</h2>
    <p>Set <b>SUPABASE_URL</b> and <b>SUPABASE_ANON_KEY</b> in Vercel → Project → Settings → Environment Variables, then redeploy.
    For local testing, copy <code>public/config.example.js</code> to <code>public/config.js</code> and fill it in.</p></div>`;
  throw new Error("Missing APP_CONFIG");
}
/* A share link (?share=<key>) opens one wedding without signing in. The key
   goes to Supabase in a header; the database decides what it unlocks
   (see supabase/migrations/20261111120000_share_links.sql). */
const SHARE_KEY = new URLSearchParams(location.search).get("share") || "";
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, SHARE_KEY ? {
  global: { headers: { "x-share-key": SHARE_KEY } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} : {});

/* ================= helpers ================= */
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = v => esc(v).replace(/\n/g, "<br>");
const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoLocal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const todayISO = () => isoLocal(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };
const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-GB", opts) : "";
const fmtLong = iso => fmtDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtStamp = ts => ts ? new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const statusCls = s => s === "Done" ? "done" : s === "In progress" ? "prog" : "";
const isLate = t => t.due_date && t.status !== "Done" && t.due_date < todayISO();
const cName = id => S.committees.find(c => c.id === id)?.name || "No committee";
const nameOf = email => email === "" ? "someone with the share link" : S.members.find(m => m.email === email)?.name || email || "";
const myName = () => nameOf(S.email);
const canWrite = () => S.role === "planner" || S.role === "member";
const isPlanner = () => S.role === "planner";
const meetingById = id => S.meetings.find(m => m.id === id);
const minutesOutstanding = m => m.meeting_date < todayISO() && !m.minutes_final;
const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));
const num = v => (v === null || v === undefined || v === "") ? null : Number(v);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.setAttribute("role", err ? "alert" : "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), err ? 5000 : 2200);
}
async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast(error.message, true); throw error; }
  if (okMsg) toast(okMsg);
  return data;
}
function opts(list, selected, { blank } = {}) {
  return (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") +
    list.map(o => {
      const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
      return `<option value="${esc(v)}" ${String(v) === String(selected ?? "") ? "selected" : ""}>${esc(l)}</option>`;
    }).join("");
}
const committeeOpts = sel => opts(S.committees.map(c => ({ value: c.id, label: c.name })), sel, { blank: "No committee" });

/* One reusable dialog. Buttons carry value="save" | "delete" | "cancel". */
function openDialog(html, onSubmit, { readOnly = false } = {}) {
  dlgForm.innerHTML = html;
  if (readOnly) dlgForm.querySelectorAll('[value="save"],[value="delete"]').forEach(b => b.remove());
  dlgForm.onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter;
    if (!btn || btn.value === "cancel") return dlg.close();
    const fd = Object.fromEntries(new FormData(dlgForm));
    btn.disabled = true;
    try { await onSubmit(fd, btn.value); dlg.close(); } catch (_) { /* toast already shown */ } finally { btn.disabled = false; }
  };
  dlg.showModal();
  if (!readOnly) dlgForm.querySelector("input:not([type=checkbox]),select,textarea")?.focus();
}
const actionsHtml = ({ save, del, cancel = "Cancel" }) =>
  `<div class="actions">${save ? `<button class="btn" value="save">${esc(save)}</button>` : ""}<button class="btn ghost" value="cancel" formnovalidate>${esc(cancel)}</button>${del ? `<button class="btn danger left" value="delete" formnovalidate>${esc(del)}</button>` : ""}</div>`;
const nextSort = list => Math.max(0, ...list.map(x => x.sort || 0)) + 1;

/* ================= header ================= */
function renderHeader() {
  const w = S.wedding;
  $("coupleNames").textContent = w ? w.couple_names : (CFG.APP_NAME || "Wedding tracker");
  $("weddingLine").textContent = w ? [fmtLong(w.wedding_date), w.ceremony_time, w.venue].filter(Boolean).join(" · ") : "";
  document.title = w ? `${w.couple_names} · Wedding tracker` : (CFG.APP_NAME || "Wedding tracker");
  if (w) {
    const days = Math.round((new Date(w.wedding_date + "T12:00:00") - new Date(todayISO() + "T12:00:00")) / 864e5);
    $("days").textContent = days > 0 ? days : days === 0 ? "Today" : "Married";
    $("daysLabel").textContent = days > 1 ? "days to go" : days === 1 ? "day to go" : days === 0 ? "is the day" : `${fmtDate(w.wedding_date, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  $("countBox").classList.toggle("hide", !w);
  $("who").classList.toggle("hide", !S.session);
  const roleLabel = { planner: "planner", member: "committee member", viewer: "view only" }[S.role];
  $("whoName").textContent = SHARE_KEY ? "Shared link: anyone with this link can view and edit"
    : S.session ? `Signed in as ${w ? myName() : S.email}${w && roleLabel ? ` (${roleLabel})` : ""}` : "";
  $("signOut").classList.toggle("hide", !!SHARE_KEY);
  $("switchWedding").classList.toggle("hide", !(w && (S.weddings.length > 1 || S.isAppAdmin)));
  $("tabs").classList.toggle("hide", !w);
}
$("signOut").onclick = () => sb.auth.signOut();
$("switchWedding").onclick = () => { S.wedding = null; location.hash = "#weddings"; };

/* ================= sign in ================= */
function renderSignIn(step = "email", email = "") {
  S.wedding = null; renderHeader();
  app.innerHTML = `<div class="signin card stack">
    <h2>Sign in</h2>
    ${step === "email" ? `
      <p class="muted small">Use the email address the planner added for you. We'll email you a 6-digit code.</p>
      <form id="emailForm"><label for="em">Email</label>
        <input id="em" name="email" type="email" autocomplete="email" required value="${esc(email)}">
        <div class="actions"><button class="btn">Email me a code</button></div></form>` : `
      <p class="muted small">We sent a code to <b>${esc(email)}</b>. Type it below, or tap the link in the email. It can take a minute to arrive; check spam too.</p>
      <form id="codeForm"><label for="code">Sign-in code</label>
        <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
        <div class="actions"><button class="btn">Sign in</button><button type="button" class="btn ghost left" id="back">Use another email</button></div></form>`}
  </div>`;
  if (step === "email") {
    $("emailForm").onsubmit = async e => {
      e.preventDefault();
      const em = e.target.email.value.trim().toLowerCase();
      e.submitter.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
      e.submitter.disabled = false;
      if (error) return toast(error.message.includes("rate") ? "Too many sign-in emails were sent recently. Wait a few minutes and try again." : error.message, true);
      renderSignIn("code", em);
    };
  } else {
    $("back").onclick = () => renderSignIn("email", email);
    $("codeForm").onsubmit = async e => {
      e.preventDefault();
      e.submitter.disabled = true;
      const { error } = await sb.auth.verifyOtp({ email, token: e.target.code.value.trim(), type: "email" });
      e.submitter.disabled = false;
      if (error) toast("That code didn't work. Check it, or go back and request a new one.", true);
    };
  }
}

/* ================= data ================= */
async function loadWeddingList() {
  const [w, a, m] = await Promise.all([
    sb.from("weddings").select("*").order("wedding_date", { ascending: true }),
    sb.from("app_admins").select("email"),
    sb.from("wedding_members").select("wedding_id, role").eq("email", S.email),
  ]);
  const err = [w, a, m].find(r => r.error);
  if (err) { toast(err.error.message, true); return false; }
  S.weddings = w.data;
  S.isAppAdmin = a.data.length > 0;
  S.myRoles = Object.fromEntries(m.data.map(r => [r.wedding_id, r.role]));
  return true;
}

async function loadWedding() {
  const wid = S.wedding.id;
  const q = (t, col, asc = true) => sb.from(t).select("*").eq("wedding_id", wid).order(col, { ascending: asc });
  const res = await Promise.all([
    sb.from("weddings").select("*").eq("id", wid).single(),
    q("committees", "sort"), q("wedding_members", "name"), q("tasks", "sort"),
    q("meetings", "meeting_date", false), q("updates", "created_at", false), q("food_items", "sort"),
  ]);
  const err = res.find(r => r.error);
  if (err) { toast(err.error.message, true); return false; }
  [S.wedding, S.committees, S.members, S.tasks, S.meetings, S.updates, S.food] = res.map(r => r.data);
  S.role = S.myRoles[wid] || (S.isAppAdmin ? "planner" : null);
  const i = S.weddings.findIndex(x => x.id === wid);
  if (i >= 0) S.weddings[i] = S.wedding;
  return true;
}
async function reload(view) { if (await loadWedding()) { renderHeader(); (view || route)(); } }

async function openWedding(id) {
  S.wedding = S.weddings.find(w => w.id === id);
  if (!S.wedding) return viewPicker();
  store.set(LAST_WEDDING_KEY, id);
  if (!(await loadWedding())) return;
  ui.taskFilter = { committee: "", status: "open", q: "" };
  renderHeader();
  if (!location.hash || location.hash === "#weddings") location.hash = "#today"; else route();
}

async function startShared() {
  S.session = { shared: true }; S.email = ""; S.isAppAdmin = false;
  const { data, error } = await sb.from("weddings").select("*");
  if (error) return toast(error.message, true);
  if (!data.length) {
    app.innerHTML = `<div class="signin card"><h2>This link doesn't work</h2>
      <p>It may have been turned off or copied incompletely. Ask the planner for the current link.</p></div>`;
    return;
  }
  S.weddings = data;
  S.myRoles = { [data[0].id]: "member" };
  openWedding(data[0].id);
}

async function start(session) {
  if (SHARE_KEY) return startShared();
  S.session = session;
  S.email = session?.user?.email?.toLowerCase() || "";
  if (!session) return renderSignIn();
  if (!(await loadWeddingList())) return;
  const last = store.get(LAST_WEDDING_KEY);
  const active = S.weddings.filter(w => !w.archived);
  const pick = S.weddings.find(w => w.id === last) || (active.length === 1 ? active[0] : null);
  if (pick && location.hash !== "#weddings") return openWedding(pick.id);
  viewPicker();
}

let lastUser;
sb.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === lastUser) { S.session = session; return; }
  lastUser = uid;
  setTimeout(() => start(session), 0);   // don't call Supabase inside the auth callback
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.wedding && !dlg.open) reload();
});

/* ================= routing ================= */
window.addEventListener("hashchange", () => { if (dlg.open) dlg.close(); route(); });
function route() {
  if (!S.session) return;
  const h = location.hash.slice(1) || "today";
  if (h === "weddings" || !S.wedding) return viewPicker();
  const tab = h.startsWith("meeting-") ? "meetings" : h;
  document.querySelectorAll("nav.tabs a").forEach(a =>
    a.getAttribute("href") === "#" + tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (h.startsWith("meeting-")) viewMeeting(Number(h.slice(8)));
  else ({ today: viewToday, checklist: viewChecklist, meetings: viewMeetings, food: viewFood, team: viewTeam }[h] || viewToday)();
  window.scrollTo(0, 0);
}

/* ================= wedding picker ================= */
function viewPicker() {
  S.wedding = null; renderHeader();
  const active = S.weddings.filter(w => !w.archived), archived = S.weddings.filter(w => w.archived);
  const tile = w => `<button type="button" class="wed" data-w="${w.id}"><div class="card"><div>
      <div class="names">${esc(w.couple_names)}</div>
      <div class="small muted">${esc([fmtLong(w.wedding_date), w.venue].filter(Boolean).join(" · "))}</div></div>
      <span class="pill">${esc({ planner: "Planner", member: "Member", viewer: "View only" }[S.myRoles[w.id]] || "Admin")}</span></div></button>`;
  app.innerHTML = `
    <div class="spread"><h2>Weddings</h2>${S.isAppAdmin ? `<button class="btn" id="newWedding">New wedding</button>` : ""}</div>
    ${!S.weddings.length ? `<div class="card empty">${S.isAppAdmin
      ? "No weddings yet. Create the first one to start its checklist from the template."
      : `${esc(S.email)} isn't on any wedding team yet. Ask the planner to add this email on their Team page, then refresh.`}</div>` : ""}
    <div class="stack">${active.map(tile).join("")}</div>
    ${archived.length ? `<details><summary>Archived weddings (${archived.length})</summary><div class="stack">${archived.map(tile).join("")}</div></details>` : ""}`;
  app.querySelectorAll("[data-w]").forEach(b => b.onclick = () => openWedding(b.dataset.w));
  $("newWedding")?.addEventListener("click", newWedding);
}

function newWedding() {
  openDialog(`
    <h2>New wedding</h2>
    <p class="small muted">Committees and the checklist are copied from the template, with due dates worked out from the wedding date. You're added as the planner.</p>
    <label for="nc">Couple</label><input id="nc" name="couple" required placeholder="e.g. Rudo & Tafadzwa">
    <div class="grid2">
      <div><label for="nd">Wedding date</label><input id="nd" name="date" type="date" required></div>
      <div><label for="ng">Expected guests</label><input id="ng" name="guests" type="number" min="0"></div>
    </div>
    <label for="nv">Venue</label><input id="nv" name="venue">
    <label for="np">Your name (as the planner)</label><input id="np" name="planner" required>
    <label for="nf">Start the food list from</label>
    <select id="nf" name="food">${opts(S.weddings.map(w => ({ value: w.id, label: `${w.couple_names} (${fmtDate(w.wedding_date, { month: "short", year: "numeric" })})` })), "", { blank: "An empty list" })}</select>
    ${actionsHtml({ save: "Create wedding" })}`,
    async fd => {
      const id = await run(sb.rpc("create_wedding", {
        p_couple_names: fd.couple.trim(), p_wedding_date: fd.date, p_venue: fd.venue || null,
        p_guest_count: num(fd.guests), p_planner_name: fd.planner.trim(), p_copy_food_from: fd.food || null,
      }), "Wedding created");
      await loadWeddingList();
      await openWedding(id);
    });
}

/* ================= shared bits ================= */
function taskRow(t) {
  const m = t.origin_meeting_id && meetingById(t.origin_meeting_id);
  return `<button type="button" class="task ${t.status === "Done" ? "is-done" : ""}" data-task="${t.id}">
    <span class="dot ${statusCls(t.status)}" aria-hidden="true"></span>
    <span class="t">${esc(t.title)}</span>
    <span class="meta"><span class="pill ${statusCls(t.status)}">${esc(t.status)}</span>
      ${t.due_date ? `<span class="${isLate(t) ? "late" : ""}">${isLate(t) ? "Overdue · " : "Due "}${esc(fmtDate(t.due_date))}</span>` : ""}
      <span>${esc(cName(t.committee_id))}</span>${t.responsible ? `<span>👤 ${esc(t.responsible)}</span>` : ""}
      ${m ? `<span>From meeting ${esc(fmtDate(m.meeting_date))}</span>` : ""}</span>
    ${t.notes ? `<span class="note">${esc(t.notes)}</span>` : ""}
  </button>`;
}
function bindTaskRows(root = app) { root.querySelectorAll("[data-task]").forEach(b => b.onclick = () => editTask(Number(b.dataset.task))); }

function updateBlock(u, { showMeeting = false, allowDelete = false } = {}) {
  const task = S.tasks.find(t => t.id === u.task_id);
  const m = meetingById(u.meeting_id);
  const del = allowDelete && (isPlanner() || (canWrite() && u.author_email === S.email));
  return `<div class="upd">
    <div class="h"><b style="color:var(--wine)">${esc(cName(u.committee_id))}</b> · ${esc(nameOf(u.author_email))} · ${esc(fmtStamp(u.created_at))}
      ${showMeeting && m ? ` · <a href="#meeting-${m.id}">meeting ${esc(fmtDate(m.meeting_date))}</a>` : ""}
      ${del ? ` · <a href="#" data-del-upd="${u.id}">Remove</a>` : ""}</div>
    ${task ? `<div class="small">Task: ${esc(task.title)}${u.new_status ? ` → <span class="pill ${statusCls(u.new_status)}">${esc(u.new_status)}</span>` : ""}</div>` : ""}
    <p><span class="lbl">Done:</span> ${nl(u.done)}</p>
    ${u.next_steps ? `<p><span class="lbl">Next:</span> ${nl(u.next_steps)}</p>` : ""}
    ${u.blockers ? `<p><span class="lbl" style="color:var(--danger)">Needs help with:</span> ${nl(u.blockers)}</p>` : ""}
  </div>`;
}
function bindUpdateDeletes(after) {
  app.querySelectorAll("[data-del-upd]").forEach(a => a.onclick = async e => {
    e.preventDefault();
    if (!confirm("Remove this update?")) return;
    await run(sb.from("updates").delete().eq("id", Number(a.dataset.delUpd)), "Update removed");
    reload(after);
  });
}

/* ================= Today ================= */
function viewToday() {
  const t0 = todayISO(), wk = addDays(t0, 7);
  const total = S.tasks.length, done = S.tasks.filter(t => t.status === "Done").length;
  const late = S.tasks.filter(isLate).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const soon = S.tasks.filter(t => t.status !== "Done" && t.due_date && t.due_date >= t0 && t.due_date <= wk).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const next = [...S.meetings].filter(m => m.meeting_date >= t0).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  const owed = S.meetings.filter(minutesOutstanding).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const openActions = S.tasks.filter(t => t.origin_meeting_id && t.status !== "Done").length;
  const foodTotal = S.food.reduce((s, f) => s + Number(f.amount), 0), foodBought = S.food.filter(f => f.bought).reduce((s, f) => s + Number(f.amount), 0);
  app.innerHTML = `
  ${owed.length ? `<div class="card alert stack"><div><b>Minutes outstanding</b> for ${plural(owed.length, "meeting")}</div>
     <div class="chips">${owed.map(m => `<a class="chip" href="#meeting-${m.id}">${esc(fmtDate(m.meeting_date))}${m.secretary ? ` · ${esc(m.secretary)}` : ""}</a>`).join("")}</div></div>` : ""}
  <div class="grid2" style="margin-top:${owed.length ? 12 : 0}px">
    <div class="card stat"><div class="muted small">Checklist</div><div class="n">${done} of ${total} done</div>
      <div class="bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>
      <div class="small muted" style="margin-top:6px">${plural(openActions, "open meeting action")}</div></div>
    <div class="card stat"><div class="muted small">Next meeting</div>
      ${next ? `<div class="n">${esc(fmtDate(next.meeting_date))}</div><div class="small">${esc([next.start_time, next.place].filter(Boolean).join(", "))}</div>
        <a class="small" href="#meeting-${next.id}">Open meeting</a>`
      : `<div class="small" style="margin-top:6px">No meeting booked.</div>${canWrite() ? `<a class="small" href="#meetings">Schedule one</a>` : ""}`}</div>
    <div class="card stat"><div class="muted small">Food budget</div><div class="n">${money(foodTotal)}</div>
      <div class="small muted">${money(foodBought)} bought so far</div></div>
  </div>
  <h3>Overdue (${late.length})</h3>
  ${late.length ? late.map(taskRow).join("") : `<p class="muted small">Nothing overdue.</p>`}
  <h3>Due in the next 7 days (${soon.length})</h3>
  ${soon.length ? soon.map(taskRow).join("") : `<p class="muted small">Nothing else due this week.</p>`}
  <h3>Latest committee updates</h3>
  <div class="card">${S.updates.length ? S.updates.slice(0, 6).map(u => updateBlock(u, { showMeeting: true })).join("") : `<p class="muted small" style="margin:0">No updates yet. They're recorded inside a meeting.</p>`}</div>`;
  bindTaskRows();
}

/* ================= Checklist ================= */
function sectionsInOrder(list) {
  const first = {};
  S.tasks.forEach(t => { const s = t.section || "Other"; first[s] = Math.min(first[s] ?? Infinity, t.sort); });
  return [...new Set(list.map(t => t.section || "Other"))].sort((a, b) =>
    a === ACTION_SECTION ? -1 : b === ACTION_SECTION ? 1 : first[a] - first[b]);
}

function viewChecklist() {
  const f = ui.taskFilter;
  const list = S.tasks.filter(t =>
    (!f.committee || String(t.committee_id) === f.committee) &&
    (f.status === "" || (f.status === "open" ? t.status !== "Done" : f.status === "late" ? isLate(t) : f.status === "actions" ? !!t.origin_meeting_id : t.status === f.status)) &&
    (!f.q || [t.title, t.notes, t.responsible].join(" ").toLowerCase().includes(f.q.toLowerCase())));
  app.innerHTML = `
  <div class="spread"><h2>Checklist</h2>${canWrite() ? `<button class="btn" id="addTask">Add task</button>` : ""}</div>
  <div class="filters">
    <select id="fc" aria-label="Committee">${opts(S.committees.map(c => ({ value: c.id, label: c.name })), f.committee, { blank: "All committees" })}</select>
    <select id="fs" aria-label="Show">${opts([{ value: "open", label: "Still to do" }, { value: "late", label: "Overdue" }, { value: "actions", label: "Meeting actions" },
      ...STATUSES.map(s => ({ value: s, label: s })), { value: "", label: "Everything" }], f.status)}</select>
    <input id="fq" type="search" placeholder="Search tasks, notes or names" value="${esc(f.q)}" aria-label="Search">
  </div>
  <p class="small muted">${plural(list.length, "task")} shown</p>
  ${sectionsInOrder(list).map(sec => `<h3>${esc(sec)}</h3>${list.filter(t => (t.section || "Other") === sec).map(taskRow).join("")}`).join("")
    || `<div class="empty">No tasks match these filters.</div>`}`;
  bindTaskRows();
  $("fc").onchange = e => { f.committee = e.target.value; viewChecklist(); };
  $("fs").onchange = e => { f.status = e.target.value; viewChecklist(); };
  const fq = $("fq");
  fq.oninput = e => {
    f.q = e.target.value; clearTimeout(fq._t);
    fq._t = setTimeout(() => { viewChecklist(); const n = $("fq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
  };
  $("addTask")?.addEventListener("click", () => editTask(null));
}

function editTask(id, defaults = {}, after) {
  const t = S.tasks.find(x => x.id === id) || { status: "Not started", section: S.tasks[0]?.section || "Tasks", ...defaults };
  const history = id ? S.updates.filter(u => u.task_id === id) : [];
  const origin = t.origin_meeting_id && meetingById(t.origin_meeting_id);
  const sections = [...new Set([...sectionsInOrder(S.tasks), t.section].filter(Boolean))];
  openDialog(`
    <h2>${id ? (canWrite() ? "Edit task" : "Task") : t.origin_meeting_id ? "New action point" : "New task"}</h2>
    ${origin ? `<p class="small muted">Action point from the meeting on ${esc(fmtLong(origin.meeting_date))}</p>` : ""}
    <fieldset ${canWrite() ? "" : "disabled"}>
    <label for="tt">${t.origin_meeting_id ? "What needs to be done" : "Task"}</label><input id="tt" name="title" required value="${esc(t.title)}">
    <div class="grid2">
      <div><label for="tr">${t.origin_meeting_id ? "Owner" : "Person responsible"}</label><input id="tr" name="responsible" value="${esc(t.responsible)}" list="peopleList"></div>
      <div><label for="td">Due date</label><input id="td" name="due_date" type="date" value="${esc(t.due_date)}"></div>
      <div><label for="tc">Committee</label><select id="tc" name="committee_id">${committeeOpts(t.committee_id)}</select></div>
      <div><label for="ts">Status</label><select id="ts" name="status">${opts(STATUSES, t.status)}</select></div>
    </div>
    ${t.origin_meeting_id ? "" : `<label for="tsec">When</label><input id="tsec" name="section" list="sectionList" value="${esc(t.section)}">
      <datalist id="sectionList">${sections.map(s => `<option value="${esc(s)}">`).join("")}</datalist>`}
    <datalist id="peopleList">${S.members.map(m => `<option value="${esc(m.name || m.email)}">`).join("")}</datalist>
    <label for="tn">Notes</label><textarea id="tn" name="notes">${esc(t.notes)}</textarea>
    </fieldset>
    ${id && t.updated_by ? `<p class="small muted">Last changed by ${esc(nameOf(t.updated_by))}, ${esc(fmtStamp(t.updated_at))}</p>` : ""}
    ${history.length ? `<h3>Updates on this task</h3>${history.map(u => updateBlock(u, { showMeeting: true })).join("")}` : ""}
    ${actionsHtml({ save: id ? "Save task" : t.origin_meeting_id ? "Add action point" : "Add task", del: id ? "Delete" : null, cancel: canWrite() ? "Cancel" : "Close" })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this task? This can't be undone.")) throw new Error("cancelled");
        await run(sb.from("tasks").delete().eq("id", id), "Task deleted");
      } else {
        const row = clean(fd);
        row.committee_id = num(row.committee_id);
        if (t.origin_meeting_id) row.section = ACTION_SECTION;
        if (id) await run(sb.from("tasks").update(row).eq("id", id), "Task saved");
        else await run(sb.from("tasks").insert({ ...row, wedding_id: S.wedding.id, origin_meeting_id: t.origin_meeting_id || null, sort: nextSort(S.tasks) }),
          t.origin_meeting_id ? "Action point added to the checklist" : "Task added");
      }
      reload(after);
    }, { readOnly: !canWrite() });
}

/* ================= Meetings ================= */
function viewMeetings() {
  const t0 = todayISO();
  const upcoming = S.meetings.filter(m => m.meeting_date >= t0).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const past = S.meetings.filter(m => m.meeting_date < t0);
  const tile = m => {
    const n = S.updates.filter(u => u.meeting_id === m.id).length;
    const a = S.tasks.filter(t => t.origin_meeting_id === m.id).length;
    return `<a class="mtg" href="#meeting-${m.id}"><div class="card row" style="flex-wrap:nowrap">
      <div class="date-tile"><b>${new Date(m.meeting_date + "T12:00:00").getDate()}</b><span>${esc(fmtDate(m.meeting_date, { month: "short" }))}</span></div>
      <div style="flex:1"><div style="font-weight:600">${esc(fmtDate(m.meeting_date, { weekday: "long", day: "numeric", month: "long" }))}${m.start_time ? `, ${esc(m.start_time)}` : ""}</div>
      <div class="small muted">${esc(m.place || "Place not set")} · ${plural(n, "update")} · ${plural(a, "action point")}</div></div>
      ${minutesOutstanding(m) ? `<span class="pill red">Minutes outstanding</span>` : m.minutes_final ? `<span class="pill done">Minutes final</span>` : ""}
    </div></a>`;
  };
  app.innerHTML = `
  <div class="spread"><h2>Meetings</h2>${canWrite() ? `<button class="btn" id="addMtg">New meeting</button>` : ""}</div>
  <p class="small muted">Each meeting follows the same order: matters arising from earlier meetings, committee updates, decisions, then new action points. Share the minutes on WhatsApp when they're final.</p>
  <h3>Coming up</h3><div class="stack">${upcoming.map(tile).join("") || `<p class="muted small">No meetings booked.</p>`}</div>
  <h3>Past meetings</h3><div class="stack">${past.map(tile).join("") || `<p class="muted small">None yet.</p>`}</div>`;
  $("addMtg")?.addEventListener("click", () => editMeeting(null));
}

function editMeeting(id) {
  const prev = [...S.meetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))[0];
  const m = meetingById(id) || { meeting_date: todayISO(), start_time: prev?.start_time, place: prev?.place, chair: prev?.chair, secretary: prev?.secretary };
  openDialog(`
    <h2>${id ? "Meeting details" : "New meeting"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <div class="grid2">
      <div><label for="md">Date</label><input id="md" name="meeting_date" type="date" required value="${esc(m.meeting_date)}"></div>
      <div><label for="mt">Time</label><input id="mt" name="start_time" placeholder="e.g. 6:30pm" value="${esc(m.start_time)}"></div>
      <div><label for="mc">Chair</label><input id="mc" name="chair" list="peopleList" value="${esc(m.chair)}"></div>
      <div><label for="ms">Minutes taken by</label><input id="ms" name="secretary" list="peopleList" value="${esc(m.secretary)}"></div>
    </div>
    <datalist id="peopleList">${S.members.map(p => `<option value="${esc(p.name || p.email)}">`).join("")}</datalist>
    <label for="mp">Where</label><input id="mp" name="place" placeholder="Church hall, WhatsApp call, Google Meet link…" value="${esc(m.place)}">
    <label for="ma">Present</label><textarea id="ma" name="attendees" style="min-height:60px" placeholder="Names, separated by commas">${esc(m.attendees)}</textarea>
    </fieldset>
    ${actionsHtml({ save: id ? "Save details" : "Create meeting", del: id && isPlanner() ? "Delete meeting" : null })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this meeting and its committee updates? Its action points stay on the checklist.")) throw new Error("cancelled");
        await run(sb.from("meetings").delete().eq("id", id), "Meeting deleted");
        location.hash = "#meetings";
      } else if (id) {
        await run(sb.from("meetings").update(clean(fd)).eq("id", id), "Meeting saved");
      } else {
        const rows = await run(sb.from("meetings").insert({ ...clean(fd), wedding_id: S.wedding.id }).select(), "Meeting created");
        await loadWedding();
        location.hash = "#meeting-" + rows[0].id;
        return;
      }
      reload();
    }, { readOnly: !canWrite() });
}

/* Action points agreed at earlier meetings that aren't done yet */
function mattersArising(m) {
  return S.tasks.filter(t => {
    if (!t.origin_meeting_id || t.status === "Done" || t.origin_meeting_id === m.id) return false;
    const o = meetingById(t.origin_meeting_id);
    return o && (o.meeting_date < m.meeting_date || (o.meeting_date === m.meeting_date && o.id < m.id));
  }).sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"));
}
const actionsFrom = m => S.tasks.filter(t => t.origin_meeting_id === m.id);

function apRow(t, { showOrigin = false } = {}) {
  const o = meetingById(t.origin_meeting_id);
  return `<div class="ap">
    <div><div class="t" data-task="${t.id}" role="button" tabindex="0">${esc(t.title)}</div>
      <div class="meta">${esc(t.responsible || "No owner")}${t.due_date ? ` · <span class="${isLate(t) ? "late" : ""}">due ${esc(fmtDate(t.due_date))}</span>` : ""}
        · ${esc(cName(t.committee_id))}${showOrigin && o ? ` · from ${esc(fmtDate(o.meeting_date))}` : ""}</div></div>
    ${canWrite() ? `<select data-ap-status="${t.id}" aria-label="Status of ${esc(t.title)}">${opts(STATUSES, t.status)}</select>` : `<span class="pill ${statusCls(t.status)}">${esc(t.status)}</span>`}
  </div>`;
}

function viewMeeting(id) {
  const m = meetingById(id);
  if (!m) { app.innerHTML = `<div class="empty">This meeting no longer exists. <a href="#meetings">Back to meetings</a></div>`; return; }
  const ups = S.updates.filter(u => u.meeting_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reported = new Set(ups.map(u => u.committee_id));
  const waiting = S.committees.filter(c => !reported.has(c.id));
  const arising = mattersArising(m), actions = actionsFrom(m);
  const back = () => viewMeeting(id);
  const owed = minutesOutstanding(m);
  app.innerHTML = `
  <p class="small"><a href="#meetings">All meetings</a></p>
  <div class="spread"><h2>${esc(fmtDate(m.meeting_date, { weekday: "long", day: "numeric", month: "long" }))}${m.start_time ? `, ${esc(m.start_time)}` : ""}</h2>
    <div class="row"><button class="btn ghost" id="editMtg">${canWrite() ? "Edit details" : "Details"}</button><button class="btn gold" id="share">Share minutes</button></div></div>

  <div class="card ${m.minutes_final ? "good" : owed ? "alert" : "notice"} spread">
    <div>${m.minutes_final
      ? `<b>Minutes final</b><div class="small muted">Marked final by ${esc(nameOf(m.minutes_final_by))}, ${esc(fmtStamp(m.minutes_final_at))}</div>`
      : owed ? `<b>Minutes outstanding</b><div class="small">${m.secretary ? `${esc(m.secretary)} is taking the minutes. ` : ""}Record decisions and action points, then mark them final.</div>`
      : `<b>Minutes in progress</b><div class="small muted">Mark them final once the decisions and action points are in.</div>`}</div>
    ${canWrite() ? (m.minutes_final ? `<button class="btn ghost" id="reopen">Reopen</button>` : `<button class="btn" id="finalise">Mark minutes final</button>`) : ""}
  </div>

  <div class="card stack" style="margin-top:12px">
    <div class="grid2">
      <div><span class="muted small">Where</span><br>${esc(m.place || "Not set")}</div>
      <div><span class="muted small">Chair / minutes</span><br>${esc(m.chair || "–")} / ${esc(m.secretary || "–")}</div>
    </div>
    <div><span class="muted small">Present</span><br>${m.attendees ? nl(m.attendees) : `<span class="muted">Not recorded</span>`}</div>
  </div>

  <div class="agenda">
  <h3><span class="n">1</span> Matters arising (${arising.length})</h3>
  <div class="card">${arising.length ? arising.map(t => apRow(t, { showOrigin: true })).join("") : `<p class="muted small" style="margin:0">No open action points from earlier meetings.</p>`}</div>

  <div class="spread"><h3><span class="n">2</span> Committee updates (${ups.length})</h3>${canWrite() ? `<button class="btn" id="addUpd">Add update</button>` : ""}</div>
  ${waiting.length ? `<p class="small muted" style="margin:0 0 6px">Still to report:</p><div class="chips">${waiting.map(c => `<button type="button" class="chip" data-c="${c.id}" ${canWrite() ? "" : "disabled"}>${esc(c.name)}</button>`).join("")}</div>`
    : `<p class="small" style="color:var(--ok)">Every committee has reported.</p>`}
  <div class="card" style="margin-top:10px">${ups.length ? ups.map(u => updateBlock(u, { allowDelete: true })).join("") : `<p class="muted small" style="margin:0">No updates recorded yet.</p>`}</div>

  <div class="spread"><h3><span class="n">3</span> Decisions and minutes</h3>${canWrite() ? `<button class="btn ghost" id="editMin">${m.minutes ? "Edit" : "Write minutes"}</button>` : ""}</div>
  <div class="card">${m.minutes ? nl(m.minutes) : `<p class="muted small" style="margin:0">Nothing written yet.</p>`}</div>

  <div class="spread"><h3><span class="n">4</span> Action points (${actions.length})</h3>${canWrite() ? `<button class="btn" id="addAp">Add action point</button>` : ""}</div>
  <p class="small muted" style="margin-top:0">Each action point goes on the checklist and comes back under matters arising at the next meeting until it's done.</p>
  <div class="card">${actions.length ? actions.map(t => apRow(t)).join("") : `<p class="muted small" style="margin:0">No action points yet.</p>`}</div>
  </div>`;

  $("editMtg").onclick = () => editMeeting(id);
  $("share").onclick = () => shareMinutes(m);
  $("finalise")?.addEventListener("click", async () => {
    if (!m.minutes && !actions.length && !ups.length) return toast("Add the decisions, updates or action points first.", true);
    await run(sb.from("meetings").update({ minutes_final: true }).eq("id", id), "Minutes marked final");
    reload(back);
  });
  $("reopen")?.addEventListener("click", async () => {
    await run(sb.from("meetings").update({ minutes_final: false }).eq("id", id), "Minutes reopened");
    reload(back);
  });
  $("addUpd")?.addEventListener("click", () => addUpdate(id, S.members.find(p => p.email === S.email)?.committee_id));
  app.querySelectorAll("[data-c]").forEach(b => b.onclick = () => addUpdate(id, Number(b.dataset.c)));
  $("editMin")?.addEventListener("click", () => editMinutes(m));
  $("addAp")?.addEventListener("click", () => editTask(null, { origin_meeting_id: id, section: ACTION_SECTION, due_date: addDays(m.meeting_date, 7) }, back));
  app.querySelectorAll("[data-task]").forEach(el => {
    const open = () => editTask(Number(el.dataset.task), {}, back);
    el.onclick = open; el.onkeydown = e => { if (e.key === "Enter") open(); };
  });
  app.querySelectorAll("[data-ap-status]").forEach(s => s.onchange = async () => {
    await run(sb.from("tasks").update({ status: s.value }).eq("id", Number(s.dataset.apStatus)), "Status saved");
    reload(back);
  });
  bindUpdateDeletes(back);
}

function editMinutes(m) {
  openDialog(`
    <h2>Decisions and minutes</h2>
    <p class="small muted">Write what was discussed and decided. Put anything someone has to do under action points, so it's tracked.</p>
    <label for="mm">Minutes</label><textarea id="mm" name="minutes" style="min-height:240px">${esc(m.minutes)}</textarea>
    ${actionsHtml({ save: "Save minutes" })}`,
    async fd => {
      await run(sb.from("meetings").update({ minutes: fd.minutes.trim() || null }).eq("id", m.id), "Minutes saved");
      reload(() => viewMeeting(m.id));
    });
}

function addUpdate(meetingId, committeeId) {
  const taskOpts = cid => opts(S.tasks.filter(t => !cid || t.committee_id === Number(cid)).map(t => ({ value: t.id, label: `${t.title} (${t.status})` })), "", { blank: "Not about one task" });
  openDialog(`
    <h2>Committee update</h2>
    <label for="uc">Committee</label><select id="uc" name="committee_id" required>${committeeOpts(committeeId)}</select>
    <label for="ut">Which task is this about?</label><select id="ut" name="task_id">${taskOpts(committeeId)}</select>
    <div id="nsWrap" class="hide"><label for="ns">Change the task's status to</label><select id="ns" name="new_status">${opts(STATUSES, "", { blank: "Leave as it is" })}</select></div>
    <label for="ud">What has been done</label><textarea id="ud" name="done" required></textarea>
    <label for="un">Next steps</label><textarea id="un" name="next_steps" style="min-height:60px"></textarea>
    <label for="ub">Needs help with (optional)</label><textarea id="ub" name="blockers" style="min-height:50px"></textarea>
    ${actionsHtml({ save: "Save update" })}`,
    async fd => {
      const row = clean({ ...fd, meeting_id: meetingId, wedding_id: S.wedding.id });
      row.committee_id = num(row.committee_id);
      row.task_id = num(row.task_id);
      if (!row.task_id) row.new_status = null;
      await run(sb.from("updates").insert(row));
      if (row.task_id && row.new_status) await run(sb.from("tasks").update({ status: row.new_status }).eq("id", row.task_id));
      toast("Update saved");
      reload(() => viewMeeting(meetingId));
    });
  const uc = $("uc"), ut = $("ut"), ns = $("nsWrap");
  uc.onchange = () => { ut.innerHTML = taskOpts(uc.value); ns.classList.add("hide"); };
  ut.onchange = () => ns.classList.toggle("hide", !ut.value);
}

/* ---------- Minutes: share as WhatsApp text or print ---------- */
function minutesText(m) {
  const w = S.wedding;
  const ups = S.updates.filter(u => u.meeting_id === m.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const reported = new Set(ups.map(u => u.committee_id));
  const waiting = S.committees.filter(c => !reported.has(c.id)).map(c => c.name);
  const arising = mattersArising(m), actions = actionsFrom(m);
  const next = [...S.meetings].filter(x => x.meeting_date > m.meeting_date).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  const ap = t => `• ${t.title} – ${t.responsible || "no owner"}${t.due_date ? `, by ${fmtDate(t.due_date)}` : ""}`;
  const L = [];
  L.push(`*${w.couple_names} wedding – committee meeting minutes*`);
  L.push([fmtLong(m.meeting_date), m.start_time, m.place].filter(Boolean).join(", "));
  if (m.chair || m.secretary) L.push(`Chair: ${m.chair || "–"} | Minutes: ${m.secretary || "–"}`);
  if (m.attendees) L.push(`Present: ${m.attendees.replace(/\s*\n\s*/g, ", ")}`);
  L.push(`${Math.max(0, Math.round((new Date(w.wedding_date + "T12:00:00") - new Date(m.meeting_date + "T12:00:00")) / 864e5))} days to the wedding`);
  L.push("", "*1. Matters arising*");
  L.push(...(arising.length ? arising.map(t => `${ap(t)} (${t.status.toLowerCase()})`) : ["None outstanding."]));
  L.push("", "*2. Committee updates*");
  if (!ups.length) L.push("No updates recorded.");
  ups.forEach(u => {
    const task = S.tasks.find(t => t.id === u.task_id);
    L.push(`_${cName(u.committee_id)}_ (${nameOf(u.author_email)})`);
    if (task) L.push(`Task: ${task.title}${u.new_status ? ` → ${u.new_status}` : ""}`);
    L.push(`Done: ${u.done}`);
    if (u.next_steps) L.push(`Next: ${u.next_steps}`);
    if (u.blockers) L.push(`Needs help: ${u.blockers}`);
    L.push("");
  });
  if (waiting.length) L.push(`No update from: ${waiting.join("; ")}`);
  L.push("", "*3. Decisions and minutes*", m.minutes || "None recorded.");
  L.push("", "*4. Action points*");
  L.push(...(actions.length ? actions.map(ap) : ["None."]));
  if (next) L.push("", `*Next meeting:* ${[fmtLong(next.meeting_date), next.start_time, next.place].filter(Boolean).join(", ")}`);
  if (!m.minutes_final) L.push("", "_Draft – not yet final._");
  return L.join("\n").replace(/\n{3,}/g, "\n\n");
}

function shareMinutes(m) {
  const text = minutesText(m);
  openDialog(`
    <h2>Share minutes</h2>
    ${m.minutes_final ? "" : `<p class="card notice small">These minutes aren't marked final yet, so they're labelled as a draft.</p>`}
    <label for="st">Message</label><textarea id="st" class="share-text" readonly>${esc(text)}</textarea>
    <div class="row" style="margin-top:12px">
      <button type="button" class="btn" id="copyMin">Copy</button>
      <a class="btn gold" id="waMin" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Send on WhatsApp</a>
      ${navigator.share ? `<button type="button" class="btn ghost" id="nativeShare">Share…</button>` : ""}
      <button type="button" class="btn ghost" id="printMin">Print or save as PDF</button>
    </div>
    ${actionsHtml({ cancel: "Close" })}`, async () => {});
  $("copyMin").onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast("Minutes copied"); }
    catch { $("st").select(); toast("Select all and copy the text", true); }
  };
  $("nativeShare")?.addEventListener("click", () => navigator.share({ title: "Meeting minutes", text }).catch(() => {}));
  $("printMin").onclick = () => printMinutes(m);
}

function printMinutes(m) {
  const w = S.wedding;
  const ups = S.updates.filter(u => u.meeting_id === m.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const arising = mattersArising(m), actions = actionsFrom(m);
  const apTable = list => list.length ? `<table><tr><th>Action</th><th>Owner</th><th>Due</th><th>Committee</th><th>Status</th></tr>
    ${list.map(t => `<tr><td>${esc(t.title)}</td><td>${esc(t.responsible || "")}</td><td>${esc(fmtDate(t.due_date))}</td><td>${esc(cName(t.committee_id))}</td><td>${esc(t.status)}</td></tr>`).join("")}</table>` : "<p>None.</p>";
  $("printArea").innerHTML = `
    <h1>${esc(w.couple_names)} wedding – committee meeting minutes</h1>
    <div class="meta">${esc([fmtLong(m.meeting_date), m.start_time, m.place].filter(Boolean).join(", "))}<br>
      Chair: ${esc(m.chair || "–")} · Minutes: ${esc(m.secretary || "–")}<br>Present: ${esc(m.attendees || "Not recorded")}
      ${m.minutes_final ? "" : "<br><b>DRAFT – not yet final</b>"}</div>
    <h2>1. Matters arising</h2>${apTable(arising)}
    <h2>2. Committee updates</h2>${ups.length ? ups.map(u => `<p><b>${esc(cName(u.committee_id))}</b> (${esc(nameOf(u.author_email))})<br>
      Done: ${nl(u.done)}${u.next_steps ? `<br>Next: ${nl(u.next_steps)}` : ""}${u.blockers ? `<br>Needs help: ${nl(u.blockers)}` : ""}</p>`).join("") : "<p>No updates recorded.</p>"}
    <h2>3. Decisions and minutes</h2><p>${m.minutes ? nl(m.minutes) : "None recorded."}</p>
    <h2>4. Action points</h2>${apTable(actions)}
    <div class="sign"><div>Chair</div><div>Minutes taken by</div><div>Date</div></div>`;
  window.print();
}

/* ================= Food ================= */
function viewFood() {
  const w = S.wedding;
  const cats = [...new Set(S.food.map(f => f.category))];
  const total = S.food.reduce((s, f) => s + Number(f.amount), 0);
  const bought = S.food.filter(f => f.bought).reduce((s, f) => s + Number(f.amount), 0);
  const who = [w.caterer_name, w.caterer_phone && `(${w.caterer_phone})`].filter(Boolean).join(" ");
  app.innerHTML = `
  <div class="spread"><h2>Food budget</h2>${canWrite() ? `<button class="btn" id="addFood">Add item</button>` : ""}</div>
  <p class="small muted">${who ? `${esc(who)} quote` : "Food list"}${w.guest_count ? ` for ${esc(w.guest_count)} people` : ""}. ${canWrite() ? "Tick items as they're bought, and change amounts if prices move." : ""}</p>
  <div class="grid2">
    <div class="card stat"><div class="muted small">Total</div><div class="n">${money(total)}</div></div>
    <div class="card stat"><div class="muted small">Bought</div><div class="n">${money(bought)}</div>
      <div class="bar"><i style="width:${total ? Math.round(bought / total * 100) : 0}%"></i></div></div>
    <div class="card stat"><div class="muted small">Still to buy</div><div class="n">${money(total - bought)}</div></div>
  </div>
  ${!S.food.length ? `<div class="card empty" style="margin-top:12px">No food items yet.${canWrite() ? " Add the caterer's list item by item." : ""}</div>` : ""}
  ${cats.map(cat => {
    const items = S.food.filter(f => f.category === cat), sub = items.reduce((s, f) => s + Number(f.amount), 0);
    return `<h3>${esc(cat)}</h3><div class="tablewrap"><table class="food"><tbody>
      ${items.map(f => `<tr class="${f.bought ? "bought" : ""}">
        <td class="chk"><input type="checkbox" data-buy="${f.id}" ${f.bought ? "checked" : ""} ${canWrite() ? "" : "disabled"} aria-label="Bought: ${esc(f.item)}"></td>
        <td><a href="#" data-fedit="${f.id}" style="color:inherit;text-decoration:none">${esc(f.item)}</a>${f.detail ? `<div class="small muted">${esc(f.detail)}</div>` : ""}${f.notes ? `<div class="small" style="color:var(--wine)">${esc(f.notes)}</div>` : ""}</td>
        <td class="amt"><input type="number" step="0.01" min="0" value="${Number(f.amount).toFixed(2)}" data-amt="${f.id}" ${canWrite() ? "" : "disabled"} aria-label="Amount for ${esc(f.item)}"></td></tr>`).join("")}
      </tbody><tfoot><tr><td></td><td>Subtotal</td><td class="amt">${money(sub)}</td></tr></tfoot></table></div>`;
  }).join("")}
  ${w.food_notes ? `<div class="card small" style="margin-top:18px"><p style="margin-top:0"><b>Notes</b></p>${w.food_notes.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join("")}</div>` : ""}`;
  app.querySelectorAll("[data-buy]").forEach(c => c.onchange = async () => {
    await run(sb.from("food_items").update({ bought: c.checked }).eq("id", Number(c.dataset.buy)));
    reload(viewFood);
  });
  app.querySelectorAll("[data-amt]").forEach(i => i.onchange = async () => {
    await run(sb.from("food_items").update({ amount: Number(i.value || 0) }).eq("id", Number(i.dataset.amt)), "Amount saved");
    reload(viewFood);
  });
  app.querySelectorAll("[data-fedit]").forEach(a => a.onclick = e => { e.preventDefault(); editFood(Number(a.dataset.fedit)); });
  $("addFood")?.addEventListener("click", () => editFood(null));
}

function editFood(id) {
  const f = S.food.find(x => x.id === id) || { category: S.food[0]?.category || "Main food items", amount: 0 };
  const cats = [...new Set(S.food.map(x => x.category))];
  openDialog(`
    <h2>${id ? "Food item" : "New food item"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <label for="fi">Item</label><input id="fi" name="item" required value="${esc(f.item)}">
    <div class="grid2">
      <div><label for="fd">Quantity / detail</label><input id="fd" name="detail" value="${esc(f.detail)}"></div>
      <div><label for="fa">Amount (USD)</label><input id="fa" name="amount" type="number" step="0.01" min="0" required value="${esc(f.amount)}"></div>
    </div>
    <label for="fcat">Group</label><input id="fcat" name="category" list="catList" required value="${esc(f.category)}">
    <datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <label for="fn">Notes</label><input id="fn" name="notes" value="${esc(f.notes)}">
    </fieldset>
    ${actionsHtml({ save: id ? "Save item" : "Add item", del: id ? "Delete" : null, cancel: canWrite() ? "Cancel" : "Close" })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this item?")) throw new Error("cancelled");
        await run(sb.from("food_items").delete().eq("id", id), "Item deleted");
      } else {
        const row = clean(fd); row.amount = Number(row.amount || 0);
        if (id) await run(sb.from("food_items").update(row).eq("id", id), "Item saved");
        else await run(sb.from("food_items").insert({ ...row, wedding_id: S.wedding.id, sort: nextSort(S.food) }), "Item added");
      }
      reload(viewFood);
    }, { readOnly: !canWrite() });
}

/* ================= Team & wedding settings ================= */
function viewTeam() {
  const w = S.wedding, planner = isPlanner();
  const roleName = r => ({ planner: "Planner", member: "Member", viewer: "View only" }[r]);
  app.innerHTML = `
  <div class="spread"><h2>Wedding details</h2>${planner ? `<button class="btn ghost" id="editWed">Edit</button>` : ""}</div>
  <div class="card grid2">
    <div><span class="muted small">Couple</span><br>${esc(w.couple_names)}</div>
    <div><span class="muted small">Date</span><br>${esc(fmtLong(w.wedding_date))}${w.ceremony_time ? `, ${esc(w.ceremony_time)}` : ""}</div>
    <div><span class="muted small">Venue</span><br>${esc(w.venue || "–")}${w.venue_address ? `<br><span class="small">${esc(w.venue_address)}</span>` : ""}</div>
    <div><span class="muted small">Guests</span><br>${esc(w.guest_count ?? "–")}</div>
    <div><span class="muted small">Caterer</span><br>${esc([w.caterer_name, w.caterer_phone].filter(Boolean).join(", ") || "–")}</div>
    ${w.archived ? `<div><span class="pill">Archived</span></div>` : ""}
  </div>

  <div class="spread" style="margin-top:22px"><h3 style="margin:0">Committees</h3>${planner ? `<button class="btn ghost" id="addCom">Add committee</button>` : ""}</div>
  <div class="stack" style="margin-top:10px">${S.committees.map(c => {
    const open = S.tasks.filter(t => t.committee_id === c.id && t.status !== "Done").length;
    const late = S.tasks.filter(t => t.committee_id === c.id && isLate(t)).length;
    const people = S.members.filter(m => m.committee_id === c.id).map(m => m.name || m.email);
    return `<div class="card spread"><div><div style="font-weight:600">${esc(c.name)}</div>
      <div class="small muted">Lead: ${esc(c.lead || "not set")}${people.length ? ` · ${esc(people.join(", "))}` : ""}</div>
      <div class="small">${plural(open, "open task")}${late ? ` · <span class="late">${late} overdue</span>` : ""} · <a href="#checklist" data-cf="${c.id}">View tasks</a></div></div>
      ${planner ? `<button class="btn ghost" data-ce="${c.id}">Edit</button>` : ""}</div>`;
  }).join("") || `<p class="muted small">No committees yet.</p>`}</div>

  <div class="spread" style="margin-top:22px"><h3 style="margin:0">People who can sign in</h3>${planner ? `<button class="btn" id="addMem">Add person</button>` : ""}</div>
  <p class="small muted">${planner ? "Planners manage people and committees. Members add and edit tasks, meetings and food. View-only people can read everything." : "Only planners can add or remove people."}</p>
  <div class="stack">${S.members.map(m => `<div class="card spread"><div>
      <div style="font-weight:600">${esc(m.name || "No name")} <span class="pill">${esc(roleName(m.role))}</span></div>
      <div class="small muted">${esc([m.email, m.phone, cName(m.committee_id)].filter(Boolean).join(" · "))}</div></div>
      ${planner ? `<button class="btn ghost" data-me="${m.id}">Edit</button>` : ""}</div>`).join("")}</div>

  ${planner ? `<h3>Keep a copy</h3>
  <div class="card stack small">
    <p style="margin:0">Download everything for this wedding (checklist, meetings, minutes, updates, food, people) as a backup file.</p>
    <div><button class="btn ghost" id="backup">Download backup</button></div></div>` : ""}

  ${S.isAppAdmin ? `<h3>For future weddings</h3>
  <div class="card stack small">
    <p style="margin:0">Make this wedding's committees and checklist the starting point for every new wedding. Due dates are saved relative to the wedding date; meeting action points are left out. This replaces the current template.</p>
    <div class="row"><button class="btn ghost" id="saveTpl">Use as template for new weddings</button>
    <button class="btn danger" id="delWed">Delete this wedding</button></div></div>` : ""}`;

  app.querySelectorAll("[data-cf]").forEach(a => a.onclick = () => { ui.taskFilter = { committee: a.dataset.cf, status: "open", q: "" }; });
  if (!planner) return;
  $("editWed").onclick = editWedding;
  $("addCom").onclick = () => editCommittee(null);
  $("addMem").onclick = () => editMember(null);
  app.querySelectorAll("[data-ce]").forEach(b => b.onclick = () => editCommittee(Number(b.dataset.ce)));
  app.querySelectorAll("[data-me]").forEach(b => b.onclick = () => editMember(Number(b.dataset.me)));
  $("backup").onclick = downloadBackup;
  $("saveTpl")?.addEventListener("click", async () => {
    if (!confirm(`Replace the template for new weddings with ${w.couple_names}'s committees and checklist?`)) return;
    const n = await run(sb.rpc("save_as_template", { p_wedding_id: w.id }));
    toast(`Template saved with ${n} tasks`);
  });
  $("delWed")?.addEventListener("click", async () => {
    const typed = prompt(`This permanently deletes ${w.couple_names}'s wedding: checklist, meetings, minutes, food and people. Download a backup first.\n\nType DELETE to confirm.`);
    if (typed !== "DELETE") return;
    await run(sb.from("weddings").delete().eq("id", w.id), "Wedding deleted");
    store.set(LAST_WEDDING_KEY, "");
    await loadWeddingList();
    location.hash = "#weddings"; viewPicker();
  });
}

function editWedding() {
  const w = S.wedding;
  openDialog(`
    <h2>Wedding details</h2>
    <label for="wc">Couple</label><input id="wc" name="couple_names" required value="${esc(w.couple_names)}">
    <div class="grid2">
      <div><label for="wd">Wedding date</label><input id="wd" name="wedding_date" type="date" required value="${esc(w.wedding_date)}"></div>
      <div><label for="wt">Ceremony time</label><input id="wt" name="ceremony_time" value="${esc(w.ceremony_time)}"></div>
      <div><label for="wv">Venue</label><input id="wv" name="venue" value="${esc(w.venue)}"></div>
      <div><label for="wg">Expected guests</label><input id="wg" name="guest_count" type="number" min="0" value="${esc(w.guest_count)}"></div>
    </div>
    <label for="wa">Venue address</label><input id="wa" name="venue_address" value="${esc(w.venue_address)}">
    <div class="grid2">
      <div><label for="wcn">Caterer</label><input id="wcn" name="caterer_name" value="${esc(w.caterer_name)}"></div>
      <div><label for="wcp">Caterer phone</label><input id="wcp" name="caterer_phone" value="${esc(w.caterer_phone)}"></div>
    </div>
    <label for="wf">Notes shown under the food list</label><textarea id="wf" name="food_notes">${esc(w.food_notes)}</textarea>
    <label class="check"><input type="checkbox" name="archived" ${w.archived ? "checked" : ""}> Archived (wedding is over; it moves to the bottom of the wedding list)</label>
    <p class="small muted">Changing the date doesn't move existing due dates.</p>
    ${actionsHtml({ save: "Save details" })}`,
    async fd => {
      const row = clean(fd);
      row.guest_count = num(row.guest_count);
      row.archived = fd.archived === "on";
      await run(sb.from("weddings").update(row).eq("id", w.id), "Details saved");
      reload(viewTeam);
    });
}

function editCommittee(id) {
  const c = S.committees.find(x => x.id === id) || {};
  openDialog(`
    <h2>${id ? "Edit committee" : "New committee"}</h2>
    <label for="cn">Name</label><input id="cn" name="name" required value="${esc(c.name)}">
    <label for="cl">Lead</label><input id="cl" name="lead" value="${esc(c.lead)}">
    ${actionsHtml({ save: "Save committee", del: id ? "Delete" : null })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this committee? Its tasks stay, but won't belong to a committee.")) throw new Error("cancelled");
        await run(sb.from("committees").delete().eq("id", id), "Committee deleted");
      } else if (id) await run(sb.from("committees").update(clean(fd)).eq("id", id), "Committee saved");
      else await run(sb.from("committees").insert({ ...clean(fd), wedding_id: S.wedding.id, sort: nextSort(S.committees) }), "Committee added");
      reload(viewTeam);
    });
}

function editMember(id) {
  const m = S.members.find(x => x.id === id) || { role: "member" };
  const self = m.email === S.email;
  openDialog(`
    <h2>${id ? "Edit person" : "Add person"}</h2>
    <label for="pe">Email</label><input id="pe" name="email" type="email" required value="${esc(m.email)}" ${self ? "readonly" : ""}>
    <div class="grid2">
      <div><label for="pn">Name</label><input id="pn" name="name" required value="${esc(m.name)}"></div>
      <div><label for="pp">Phone (optional)</label><input id="pp" name="phone" type="tel" value="${esc(m.phone)}"></div>
      <div><label for="pc">Committee</label><select id="pc" name="committee_id">${committeeOpts(m.committee_id)}</select></div>
      <div><label for="pr">Access</label><select id="pr" name="role" ${self ? "disabled" : ""}>${opts([{ value: "planner", label: "Planner" }, { value: "member", label: "Member" }, { value: "viewer", label: "View only" }], m.role)}</select></div>
    </div>
    <p class="small muted">They sign in on this site with this email. Nothing is sent until they ask for a code, so tell them the link.</p>
    ${actionsHtml({ save: "Save person", del: id && !self ? "Remove" : null })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm(`Remove ${m.name || m.email}? They won't be able to see this wedding.`)) throw new Error("cancelled");
        await run(sb.from("wedding_members").delete().eq("id", id), "Person removed");
      } else {
        const row = { name: fd.name.trim(), phone: fd.phone?.trim() || null, committee_id: num(fd.committee_id) };
        if (!self) { row.email = fd.email.trim().toLowerCase(); row.role = fd.role; }
        if (id) await run(sb.from("wedding_members").update(row).eq("id", id), "Person saved");
        else await run(sb.from("wedding_members").insert({ ...row, wedding_id: S.wedding.id }), "Person added");
      }
      reload(viewTeam);
    });
}

function downloadBackup() {
  const { wedding, committees, members, tasks, meetings, updates, food } = S;
  const data = { exported_at: new Date().toISOString(), wedding, committees, members, tasks, meetings, updates, food_items: food };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${wedding.couple_names.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
