/* Wedding tracker – one app, many weddings.
   Data lives in Supabase; see supabase/migrations for the schema and access rules. */
"use strict";

const CFG = window.APP_CONFIG || {};
const STATUSES = ["Not started", "In progress", "Done"];
const ACTION_SECTION = "Meeting actions";
const LAST_WEDDING_KEY = "weddingTracker.lastWedding";

const BUDGET_STATUSES = ["Not started", "In progress", "Done", "N/A"];
const SIDES = ["Bride", "Groom", "Both", "Church"];
const DAYS = ["Day before", "Wedding day"];

const S = {
  session: null, email: "", isAppAdmin: false,
  weddings: [], myRoles: {},            // wedding_id -> role
  wedding: null, role: null,
  committees: [], members: [], tasks: [], meetings: [], updates: [], food: [],
  budget: [], guests: [], vendors: [], schedule: [],
};
const ui = {
  taskFilter: { committee: "", status: "open", q: "" },
  budgetFilter: { cat: "", status: "", q: "", costed: false, ref: false },
  guestFilter: { side: "", confirmed: "", q: "" },
};

/* Menu. "primary" pages sit in the phone's bottom bar; the rest go under More. */
const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  checklist: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  budget: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.4"/>',
  guests: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  vendors: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  meetings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  food: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18"/><path d="M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>',
  team: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.2"/><circle cx="19" cy="10" r="2.2"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0M1.5 19a3.6 3.6 0 0 1 5-3.3M22.5 19a3.6 3.6 0 0 0-5-3.3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
const NAV = [
  { id: "dashboard", label: "Dashboard", primary: true },
  { id: "checklist", label: "Checklist", primary: true },
  { id: "budget", label: "Budget", primary: true },
  { id: "guests", label: "Guests", primary: true },
  { id: "vendors", label: "Vendors" },
  { id: "schedule", label: "Day schedule" },
  { id: "meetings", label: "Meetings" },
  { id: "food", label: "Food" },
  { id: "team", label: "Team & settings" },
];

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
const plural = (n, w) => `${n} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s"}`;
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

/* Page building blocks */
const pageHead = (title, subHtml = "", actions = "") =>
  `<div class="phead"><div><h1>${esc(title)}</h1>${subHtml ? `<p class="psub">${subHtml}</p>` : ""}</div>${actions ? `<div class="pact">${actions}</div>` : ""}</div>`;
const pct = (a, b) => b ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0;
const kpi = (label, value, foot = "", { tone = "", bar = null, barCls = "", href = "" } = {}) => {
  const inner = `<div class="kl">${label}</div><div class="kv">${value}</div>${bar !== null ? `<div class="bar ${barCls}"><i style="width:${bar}%"></i></div>` : ""}${foot ? `<div class="kf">${foot}</div>` : ""}`;
  return href ? `<a class="kpi ${tone}" href="${href}">${inner}</a>` : `<div class="kpi ${tone}">${inner}</div>`;
};
const stCls = s => s === "Done" ? "done" : s === "In progress" ? "prog" : s === "N/A" ? "na" : "";
const statusSelect = (attr, id, value, list, label) =>
  `<select class="st ${stCls(value)}" ${attr}="${id}" aria-label="${esc(label)}">${opts(list, value)}</select>`;
const telLink = p => p ? `<a class="tel" href="tel:${esc(p.replace(/[^\d+]/g, ""))}">${esc(p)}</a>` : "";
/* Rows open their editor on click, except when the click lands on a control inside the row */
function bindRows(selector, fn, root = app) {
  root.querySelectorAll(selector).forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("select, input, a, button, label")) return;
    fn(tr);
  }));
}
function shareTextDialog(title, text, { onPrint, note = "" } = {}) {
  openDialog(`
    <h2>${esc(title)}</h2>${note}
    <label for="st">Message</label><textarea id="st" class="share-text" readonly>${esc(text)}</textarea>
    <div class="row" style="margin-top:12px">
      <button type="button" class="btn" id="copyTxt">Copy</button>
      <a class="btn gold" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Send on WhatsApp</a>
      ${navigator.share ? `<button type="button" class="btn ghost" id="nativeShare">Share…</button>` : ""}
      ${onPrint ? `<button type="button" class="btn ghost" id="printTxt">Print or save as PDF</button>` : ""}
    </div>
    ${actionsHtml({ cancel: "Close" })}`, async () => {});
  $("copyTxt").onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast("Copied"); }
    catch { $("st").select(); toast("Select all and copy the text", true); }
  };
  $("nativeShare")?.addEventListener("click", () => navigator.share({ title, text }).catch(() => {}));
  $("printTxt")?.addEventListener("click", onPrint);
}

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
const daysToGo = w => Math.round((new Date(w.wedding_date + "T12:00:00") - new Date(todayISO() + "T12:00:00")) / 864e5);

function renderHeader() {
  const w = S.wedding;
  const appName = CFG.APP_NAME || "Wedding tracker";
  document.body.classList.toggle("no-wedding", !w);
  $("coupleNames").textContent = w ? w.couple_names : appName;
  $("tbNames").textContent = w ? w.couple_names : appName;
  $("weddingLine").innerHTML = w ? [fmtLong(w.wedding_date), [w.ceremony_time, w.venue].filter(Boolean).join(" · ")].filter(Boolean).map(esc).join("<br>") : "";
  document.title = w ? `${w.couple_names} · Wedding tracker` : appName;
  if (w) {
    const days = daysToGo(w);
    $("days").textContent = days > 0 ? days : days === 0 ? "Today" : "Married";
    $("daysLabel").textContent = days > 1 ? "days to go" : days === 1 ? "day to go" : days === 0 ? "is the day" : fmtDate(w.wedding_date, { day: "numeric", month: "short", year: "numeric" });
    $("tbCount").innerHTML = days > 0 ? `<b>${days}</b>days to go` : esc(days === 0 ? "Today's the day" : "Married");
  } else $("tbCount").textContent = "";
  $("countBox").classList.toggle("hide", !w);
  $("who").classList.toggle("hide", !S.session || !w);
  const roleLabel = { planner: "planner", member: "committee member", viewer: "view only" }[S.role];
  $("whoName").textContent = SHARE_KEY ? "Shared link: anyone with this link can view and edit"
    : S.session ? `Signed in as ${w ? myName() : S.email}${w && roleLabel ? ` (${roleLabel})` : ""}` : "";
  $("signOut").classList.toggle("hide", !!SHARE_KEY);
  $("tbSignOut").classList.toggle("hide", !S.session || !!SHARE_KEY || !!w);
  $("switchWedding").classList.toggle("hide", !(w && (S.weddings.length > 1 || S.isAppAdmin)));
  renderNav();
}

/* Badges: overdue tasks on Checklist, meetings still missing minutes on Meetings */
function navBadge(id) {
  if (!S.wedding) return "";
  const n = id === "checklist" ? S.tasks.filter(isLate).length : id === "meetings" ? S.meetings.filter(minutesOutstanding).length : 0;
  return n ? `<span class="badge" title="${id === "checklist" ? "Overdue tasks" : "Minutes outstanding"}">${n}</span>` : "";
}
function currentPage() {
  const h = location.hash.slice(1) || "dashboard";
  return h.startsWith("meeting-") ? "meetings" : h === "today" ? "dashboard" : h;
}
function renderNav() {
  const w = S.wedding, cur = currentPage();
  const link = (n, cls = "") => `<a href="#${n.id}" class="${cls}" ${n.id === cur ? 'aria-current="page"' : ""}>${icon(n.id)}<span>${esc(n.label)}</span>${navBadge(n.id)}</a>`;
  $("nav").innerHTML = w ? NAV.map(n => link(n)).join("") : "";
  const moreActive = NAV.some(n => !n.primary && n.id === cur);
  const moreBadge = NAV.filter(n => !n.primary).map(n => navBadge(n.id)).find(Boolean) || "";
  $("bottom").innerHTML = w ? NAV.filter(n => n.primary).map(n => link(n)).join("") +
    `<button type="button" id="moreBtn" ${moreActive ? 'aria-current="page"' : ""} aria-haspopup="true">${icon("more")}<span>More</span>${moreBadge}</button>` : "";
  $("bottom").classList.toggle("hide", !w);
  $("morePanel").innerHTML = NAV.filter(n => !n.primary).map(n => link(n)).join("") +
    (SHARE_KEY ? "" : `<a href="#" id="moreSignOut">${icon("team")}<span>Sign out</span></a>`);
  $("moreBtn")?.addEventListener("click", () => $("moreSheet").classList.remove("hide"));
  $("moreSignOut")?.addEventListener("click", e => { e.preventDefault(); sb.auth.signOut(); });
}
$("moreSheet").addEventListener("click", e => { if (e.target.id === "moreSheet" || e.target.closest("a")) $("moreSheet").classList.add("hide"); });
$("signOut").onclick = () => sb.auth.signOut();
$("tbSignOut").onclick = () => sb.auth.signOut();
$("switchWedding").onclick = () => { S.wedding = null; location.hash = "#weddings"; };

/* ================= sign in ================= */
function renderSignIn(step = "email", email = "") {
  S.wedding = null; renderHeader();
  app.innerHTML = `<div class="signin card stack">
    <h2>Sign in</h2>
    ${step === "email" ? `
      <p class="muted small">Use the email address the planner added for you. We'll email you a sign-in code.</p>
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
    q("budget_items", "sort"), q("guests", "sort"), q("vendors", "sort"), q("schedule_items", "sort"),
  ]);
  const err = res.find(r => r.error);
  if (err) { toast(err.error.message, true); return false; }
  [S.wedding, S.committees, S.members, S.tasks, S.meetings, S.updates, S.food,
    S.budget, S.guests, S.vendors, S.schedule] = res.map(r => r.data);
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
  if (!location.hash || location.hash === "#weddings") location.hash = "#dashboard"; else route();
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
  const h = location.hash.slice(1) || "dashboard";
  if (h === "weddings" || !S.wedding) return viewPicker();
  $("moreSheet").classList.add("hide");
  renderNav();
  if (h.startsWith("meeting-")) viewMeeting(Number(h.slice(8)));
  else ({
    dashboard: viewDashboard, today: viewDashboard, checklist: viewChecklist, budget: viewBudget, guests: viewGuests,
    vendors: viewVendors, schedule: viewSchedule, meetings: viewMeetings, food: viewFood, team: viewTeam,
  }[h] || viewDashboard)();
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
    ${pageHead("Weddings", "", S.isAppAdmin ? `<button class="btn" id="newWedding">New wedding</button>` : "")}
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

/* ================= Budget maths (shared by Dashboard and Budget) ================= */
const foodTotal = () => S.food.reduce((s, f) => s + Number(f.amount), 0);
/* Linked lines: "food" takes the Food list total, "contingency" is 10% of every other line.
   Lines marked N/A don't count towards totals. */
function budgetLines() {
  const rows = S.budget.map(b => ({ ...b, cost: b.linked === "food" ? foodTotal() : Number(b.cost),
    deposit: Number(b.deposit), paid: Number(b.paid), pledged_amount: Number(b.pledged_amount) }));
  const base = rows.filter(b => b.linked !== "contingency" && b.status !== "N/A").reduce((s, b) => s + b.cost, 0);
  rows.forEach(b => {
    if (b.linked === "contingency") b.cost = Math.round(base * 10) / 100;
    b.balance = b.cost - b.deposit - b.paid;
  });
  return rows;
}
function budgetTotals(rows = budgetLines()) {
  const t = { cost: 0, deposit: 0, paid: 0, balance: 0, pledged: 0, ref: 0 };
  rows.filter(b => b.status !== "N/A").forEach(b => {
    t.cost += b.cost; t.deposit += b.deposit; t.paid += b.paid; t.balance += b.balance; t.pledged += b.pledged_amount; t.ref += Number(b.ref_cost || 0);
  });
  return t;
}
const guestStats = () => {
  const yes = S.guests.filter(g => g.confirmed === "Yes");
  return {
    entries: S.guests.length,
    invitedPeople: S.guests.reduce((s, g) => s + g.people, 0),
    confirmedPeople: yes.reduce((s, g) => s + g.people, 0),
    awaiting: S.guests.filter(g => !g.confirmed || g.confirmed === "Maybe").length,
    declined: S.guests.filter(g => g.confirmed === "No").length,
    cars: yes.filter(g => g.needs_parking).length,
  };
};

/* ================= Dashboard ================= */
function taskLine(t) {
  return `<li data-task="${t.id}"><span class="dot ${statusCls(t.status)}" style="margin-top:4px"></span><div>
    <div class="t">${esc(t.title)}</div>
    <div class="m"><span class="${isLate(t) ? "late" : ""}">${isLate(t) ? "Overdue · " : "Due "}${esc(fmtDate(t.due_date))}</span>
      <span>${esc(cName(t.committee_id))}</span>${t.responsible ? `<span>${esc(t.responsible)}</span>` : ""}</div></div></li>`;
}

function viewDashboard() {
  const w = S.wedding, t0 = todayISO(), wk = addDays(t0, 7);
  const total = S.tasks.length, done = S.tasks.filter(t => t.status === "Done").length;
  const late = S.tasks.filter(isLate).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const soon = S.tasks.filter(t => t.status !== "Done" && t.due_date && t.due_date >= t0 && t.due_date <= wk).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const next = [...S.meetings].filter(m => m.meeting_date >= t0).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  const owed = S.meetings.filter(minutesOutstanding).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const lines = budgetLines(), bt = budgetTotals(lines);
  const g = guestStats(), cap = w.venue_capacity || w.guest_count;
  const booked = S.vendors.filter(v => v.name).length, vConfirmed = S.vendors.filter(v => v.confirmed).length;
  const days = daysToGo(w);
  const cats = [...new Set(lines.map(b => b.category))].map(c => ({ c, v: lines.filter(b => b.category === c && b.status !== "N/A").reduce((s, b) => s + b.cost, 0) }))
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 7);
  const maxCat = Math.max(1, ...cats.map(x => x.v));
  const notes = (w.venue_notes || "").split(/\n+/).filter(Boolean);
  app.innerHTML = `
  ${pageHead("Dashboard", esc([fmtLong(w.wedding_date), w.ceremony_time, w.venue].filter(Boolean).join(" · ")))}
  ${owed.length ? `<div class="card alert row" style="margin-bottom:14px"><b>Minutes outstanding</b>
     <div class="chips">${owed.map(m => `<a class="chip" href="#meeting-${m.id}">${esc(fmtDate(m.meeting_date))}${m.secretary ? ` · ${esc(m.secretary)}` : ""}</a>`).join("")}</div></div>` : ""}
  <div class="kpis">
    ${kpi("Countdown", days > 0 ? days : days === 0 ? "Today" : "Married", days > 0 ? `days to ${esc(fmtDate(w.wedding_date, { day: "numeric", month: "long" }))}` : "", { tone: "hero" })}
    ${kpi("Checklist", `${pct(done, total)}%`, `${done} of ${total} done${late.length ? ` · <span class="late">${late.length} overdue</span>` : ""}`, { bar: pct(done, total), href: "#checklist" })}
    ${kpi("Budget", money(bt.cost), `${money(bt.deposit + bt.paid)} paid · ${money(bt.balance)} owed`, { bar: pct(bt.deposit + bt.paid, bt.cost), barCls: "gold", href: "#budget" })}
    ${kpi("Guests confirmed", `${g.confirmedPeople}${cap ? ` <small>/ ${cap}</small>` : ""}`, `${plural(g.entries, "entry")} on the list · ${plural(g.cars, "car")} expected`,
      { bar: cap ? pct(g.confirmedPeople, cap) : null, barCls: cap && g.confirmedPeople > cap ? "red" : "", tone: cap && g.confirmedPeople > cap ? "bad" : "", href: "#guests" })}
    ${kpi("Vendors", `${booked} <small>/ ${S.vendors.length}</small>`, `booked · ${vConfirmed} confirmed`, { bar: pct(booked, S.vendors.length), href: "#vendors" })}
    ${kpi("Next meeting", next ? esc(fmtDate(next.meeting_date)) : "None", next ? esc([next.start_time, next.place].filter(Boolean).join(", ")) || "Open the meeting" : "Book one on Meetings", { href: next ? `#meeting-${next.id}` : "#meetings" })}
  </div>
  <div class="dash">
    <div>
      <div class="card flush"><div class="card-h"><h2>Needs attention</h2><a class="small" href="#checklist">Full checklist</a></div>
        <ul class="list">
          ${late.length ? late.map(taskLine).join("") : ""}
          ${soon.length ? soon.map(taskLine).join("") : ""}
          ${!late.length && !soon.length ? `<li class="empty-li">Nothing overdue or due in the next 7 days.</li>` : ""}
        </ul></div>
      <div class="card flush"><div class="card-h"><h2>Latest committee updates</h2><a class="small" href="#meetings">Meetings</a></div>
        <div class="card-b">${S.updates.length ? S.updates.slice(0, 5).map(u => updateBlock(u, { showMeeting: true })).join("") : `<p class="muted small" style="margin:0">No updates yet. They're recorded inside a meeting.</p>`}</div></div>
    </div>
    <div>
      <div class="card flush"><div class="card-h"><h2>Budget summary</h2><a class="small" href="#budget">Main budget</a></div>
        <div class="card-b">
          <dl class="facts">
            <dt>Total estimated cost</dt><dd>${money(bt.cost)}</dd>
            <dt>Deposits paid</dt><dd>${money(bt.deposit)}</dd>
            <dt>Other payments made</dt><dd>${money(bt.paid)}</dd>
            <dt>Balance still owed</dt><dd>${money(bt.balance)}</dd>
            <dt>Covered by pledges</dt><dd>${money(bt.pledged)}</dd>
          </dl>
          ${cats.length ? `<div class="catbars" style="margin-top:12px">${cats.map(x => `<div class="cb"><span>${esc(x.c)}</span><b>${money(x.v)}</b><div class="bar gold"><i style="width:${pct(x.v, maxCat)}%"></i></div></div>`).join("")}</div>` : ""}
        </div></div>
      <div class="card flush"><div class="card-h"><h2>Wedding details</h2>${isPlanner() ? `<a class="small" href="#team">Edit</a>` : ""}</div>
        <div class="card-b">
          <dl class="facts">
            <dt>Couple</dt><dd>${esc(w.couple_names)}</dd>
            <dt>Date</dt><dd>${esc(fmtLong(w.wedding_date))}${w.ceremony_time ? `, ${esc(w.ceremony_time)}` : ""}</dd>
            <dt>Venue</dt><dd>${esc(w.venue || "–")}${w.venue_address ? `<br><span class="small muted">${esc(w.venue_address)}</span>` : ""}</dd>
            <dt>Seats</dt><dd>${esc(w.venue_capacity ?? "–")}</dd>
            <dt>Expected guests</dt><dd>${esc(w.guest_count ?? "–")}</dd>
            <dt>Caterer</dt><dd>${esc([w.caterer_name, w.caterer_phone].filter(Boolean).join(", ") || "–")}</dd>
          </dl>
          ${notes.length ? `<h3 style="margin-top:16px">Venue notes</h3><ul class="notes-list">${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        </div></div>
    </div>
  </div>`;
  app.querySelectorAll("[data-task]").forEach(li => li.onclick = () => editTask(Number(li.dataset.task)));
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
  const total = S.tasks.length, done = S.tasks.filter(t => t.status === "Done").length;
  const row = t => {
    const m = t.origin_meeting_id && meetingById(t.origin_meeting_id);
    return `<tr class="click ${t.status === "Done" ? "is-done" : ""}" data-task="${t.id}">
      <td class="main">${esc(t.title)}${m ? `<div class="sub">Action from the meeting on ${esc(fmtDate(m.meeting_date))}</div>` : ""}</td>
      <td class="nowrap" data-l="Due">${t.due_date ? `<span class="${isLate(t) ? "late" : ""}">${esc(fmtDate(t.due_date))}</span>` : `<span class="muted">–</span>`}</td>
      <td data-l="Committee">${esc(cName(t.committee_id))}</td>
      <td class="opt" data-l="Responsible">${esc(t.responsible || "")}</td>
      <td data-l="Status">${canWrite() ? statusSelect("data-tstatus", t.id, t.status, STATUSES, `Status of ${t.title}`) : `<span class="pill ${statusCls(t.status)}">${esc(t.status)}</span>`}</td>
      <td class="opt m-hide" data-l="Notes"><div class="clip">${esc(t.notes || "")}</div></td>
    </tr>`;
  };
  app.innerHTML = `
  ${pageHead("Checklist", `${done} of ${total} tasks done · ${S.tasks.filter(isLate).length} overdue`, canWrite() ? `<button class="btn" id="addTask">Add task</button>` : "")}
  <div class="toolbar">
    <input id="fq" type="search" placeholder="Search tasks, notes or names" value="${esc(f.q)}" aria-label="Search">
    <select id="fc" aria-label="Committee">${opts(S.committees.map(c => ({ value: c.id, label: c.name })), f.committee, { blank: "All committees" })}</select>
    <select id="fs" aria-label="Show">${opts([{ value: "open", label: "Still to do" }, { value: "late", label: "Overdue" }, { value: "actions", label: "Meeting actions" },
      ...STATUSES.map(s => ({ value: s, label: s })), { value: "", label: "Everything" }], f.status)}</select>
    <span class="count">${plural(list.length, "task")} shown</span>
  </div>
  ${list.length ? `<div class="tcard"><table class="tbl">
    <thead><tr><th>Task</th><th>Due</th><th>Committee</th><th>Responsible</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${sectionsInOrder(list).map(sec => `<tr class="grp"><td colspan="6">${esc(sec)}</td></tr>${list.filter(t => (t.section || "Other") === sec).map(row).join("")}`).join("")}</tbody>
  </table></div>` : `<div class="card empty">No tasks match these filters.</div>`}`;
  bindRows("[data-task]", tr => editTask(Number(tr.dataset.task)));
  app.querySelectorAll("[data-tstatus]").forEach(s => s.onchange = async () => {
    await run(sb.from("tasks").update({ status: s.value }).eq("id", Number(s.dataset.tstatus)), "Status saved");
    reload(viewChecklist);
  });
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
  ${pageHead("Meetings", "Each meeting follows the same order: matters arising, committee updates, decisions, then new action points. Share the minutes on WhatsApp when they're final.",
    canWrite() ? `<button class="btn" id="addMtg">New meeting</button>` : "")}
  <div class="two">
    <div><h3 style="margin-top:0">Coming up</h3><div class="stack">${upcoming.map(tile).join("") || `<div class="card muted small">No meetings booked.</div>`}</div></div>
    <div><h3 style="margin-top:0">Past meetings</h3><div class="stack">${past.map(tile).join("") || `<div class="card muted small">None yet.</div>`}</div></div>
  </div>`;
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
  <p class="small" style="margin:0 0 6px"><a href="#meetings">← All meetings</a></p>
  ${pageHead(`${fmtDate(m.meeting_date, { weekday: "long", day: "numeric", month: "long" })}${m.start_time ? `, ${m.start_time}` : ""}`, "Committee meeting",
    `<button class="btn ghost" id="editMtg">${canWrite() ? "Edit details" : "Details"}</button><button class="btn gold" id="share">Share minutes</button>`)}

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
  shareTextDialog("Share minutes", minutesText(m), {
    onPrint: () => printMinutes(m),
    note: m.minutes_final ? "" : `<p class="card notice small">These minutes aren't marked final yet, so they're labelled as a draft.</p>`,
  });
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
  ${pageHead("Food", `${who ? `${esc(who)} quote` : "Food list"}${w.guest_count ? ` for ${esc(w.guest_count)} people` : ""}. ${canWrite() ? "Tick items as they're bought, and change amounts if prices move. The total feeds the main budget." : ""}`,
    canWrite() ? `<button class="btn" id="addFood">Add item</button>` : "")}
  <div class="kpis" style="margin-bottom:16px">
    ${kpi("Food total", money(total), `${plural(S.food.length, "item")}`)}
    ${kpi("Bought", money(bought), `${pct(bought, total)}% of the list`, { bar: pct(bought, total) })}
    ${kpi("Still to buy", money(total - bought), "", { tone: total - bought > 0 ? "warn" : "good" })}
  </div>
  ${!S.food.length ? `<div class="card empty">No food items yet.${canWrite() ? " Add the caterer's list item by item." : ""}</div>` : `
  <div class="tcard"><table class="tbl">
    <thead><tr><th>Bought</th><th>Item</th><th>Quantity</th><th class="num">Amount (USD)</th></tr></thead>
    <tbody>${cats.map(cat => {
      const items = S.food.filter(f => f.category === cat), sub = items.reduce((s, f) => s + Number(f.amount), 0);
      return `<tr class="grp"><td colspan="3">${esc(cat)}</td><td class="num">${money(sub)}</td></tr>` + items.map(f => `<tr class="click ${f.bought ? "is-done" : ""}" data-fedit="${f.id}">
        <td class="chk" data-l="Bought"><input type="checkbox" data-buy="${f.id}" ${f.bought ? "checked" : ""} ${canWrite() ? "" : "disabled"} aria-label="Bought: ${esc(f.item)}"></td>
        <td class="main">${esc(f.item)}${f.notes ? `<div class="sub" style="color:var(--wine)">${esc(f.notes)}</div>` : ""}</td>
        <td class="opt" data-l="Quantity">${esc(f.detail || "")}</td>
        <td class="amt" data-l="Amount"><input type="number" step="0.01" min="0" value="${Number(f.amount).toFixed(2)}" data-amt="${f.id}" ${canWrite() ? "" : "disabled"} aria-label="Amount for ${esc(f.item)}"></td></tr>`).join("");
    }).join("")}</tbody>
    <tfoot><tr><td colspan="3" data-l="">Total</td><td class="num" data-l="Total">${money(total)}</td></tr></tfoot>
  </table></div>`}
  ${w.food_notes ? `<div class="card small" style="margin-top:16px"><h2>Notes</h2>${w.food_notes.split(/\n+/).map(p => `<p style="margin:4px 0">${esc(p)}</p>`).join("")}</div>` : ""}`;
  app.querySelectorAll("[data-buy]").forEach(c => c.onchange = async () => {
    await run(sb.from("food_items").update({ bought: c.checked }).eq("id", Number(c.dataset.buy)));
    reload(viewFood);
  });
  app.querySelectorAll("[data-amt]").forEach(i => i.onchange = async () => {
    await run(sb.from("food_items").update({ amount: Number(i.value || 0) }).eq("id", Number(i.dataset.amt)), "Amount saved");
    reload(viewFood);
  });
  bindRows("[data-fedit]", tr => editFood(Number(tr.dataset.fedit)));
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
  ${pageHead("Team & settings", "Wedding details, committees and who can sign in.")}
  <div class="card flush"><div class="card-h"><h2>Wedding details</h2>${planner ? `<button class="btn ghost sm" id="editWed">Edit</button>` : ""}</div>
    <div class="card-b"><dl class="facts">
      <dt>Couple</dt><dd>${esc(w.couple_names)}${w.archived ? ` <span class="pill">Archived</span>` : ""}</dd>
      <dt>Date</dt><dd>${esc(fmtLong(w.wedding_date))}${w.ceremony_time ? `, ${esc(w.ceremony_time)}` : ""}</dd>
      <dt>Venue</dt><dd>${esc(w.venue || "–")}${w.venue_address ? `, ${esc(w.venue_address)}` : ""}</dd>
      <dt>Seats</dt><dd>${esc(w.venue_capacity ?? "–")}</dd>
      <dt>Expected guests</dt><dd>${esc(w.guest_count ?? "–")}</dd>
      <dt>Caterer</dt><dd>${esc([w.caterer_name, w.caterer_phone].filter(Boolean).join(", ") || "–")}</dd>
    </dl></div></div>

  <div class="section-title"><h2>Committees</h2>${planner ? `<button class="btn ghost sm" id="addCom">Add committee</button>` : ""}</div>
  ${S.committees.length ? `<div class="tcard"><table class="tbl">
    <thead><tr><th>Committee</th><th>Lead</th><th>People</th><th class="num">Open tasks</th><th class="num">Overdue</th><th></th></tr></thead>
    <tbody>${S.committees.map(c => {
      const open = S.tasks.filter(t => t.committee_id === c.id && t.status !== "Done").length;
      const late = S.tasks.filter(t => t.committee_id === c.id && isLate(t)).length;
      const people = S.members.filter(m => m.committee_id === c.id).map(m => m.name || m.email);
      return `<tr class="${planner ? "click" : ""}" data-ce="${c.id}">
        <td class="main">${esc(c.name)}</td><td data-l="Lead">${esc(c.lead || "–")}</td>
        <td class="opt" data-l="People">${esc(people.join(", "))}</td>
        <td class="num" data-l="Open tasks">${open}</td><td class="num" data-l="Overdue">${late ? `<span class="late">${late}</span>` : `<span class="zero">0</span>`}</td>
        <td class="num" data-l=""><a href="#checklist" data-cf="${c.id}">View tasks</a></td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="card muted small">No committees yet.</div>`}

  <div class="section-title"><h2>People who can sign in</h2>${planner ? `<button class="btn sm" id="addMem">Add person</button>` : ""}</div>
  <p class="small muted" style="margin-top:-4px">${planner ? "Planners manage people and committees. Members add and edit tasks, meetings, budget, guests and food. View-only people can read everything." : "Only planners can add or remove people."}</p>
  <div class="tcard"><table class="tbl">
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Committee</th><th>Access</th></tr></thead>
    <tbody>${S.members.map(m => `<tr class="${planner ? "click" : ""}" data-me="${m.id}">
      <td class="main">${esc(m.name || "No name")}</td><td data-l="Email">${esc(m.email)}</td><td class="opt" data-l="Phone">${telLink(m.phone)}</td>
      <td data-l="Committee">${esc(cName(m.committee_id))}</td><td data-l="Access"><span class="pill">${esc(roleName(m.role))}</span></td></tr>`).join("")}</tbody>
  </table></div>

  ${planner ? `<h3>Keep a copy</h3>
  <div class="card stack small">
    <p style="margin:0">Download everything for this wedding (checklist, meetings, minutes, budget, guests, vendors, schedule, food, people) as a backup file.</p>
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
  bindRows("[data-ce]", tr => editCommittee(Number(tr.dataset.ce)));
  bindRows("[data-me]", tr => editMember(Number(tr.dataset.me)));
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
      <div><label for="wcap">Venue seats</label><input id="wcap" name="venue_capacity" type="number" min="0" value="${esc(w.venue_capacity)}"></div>
    </div>
    <label for="wa">Venue address</label><input id="wa" name="venue_address" value="${esc(w.venue_address)}">
    <label for="wvn">Venue notes (one per line, shown on the dashboard)</label><textarea id="wvn" name="venue_notes">${esc(w.venue_notes)}</textarea>
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
      row.venue_capacity = num(row.venue_capacity);
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
  const { wedding, committees, members, tasks, meetings, updates, food, budget, guests, vendors, schedule } = S;
  const data = { exported_at: new Date().toISOString(), wedding, committees, members, tasks, meetings, updates, food_items: food,
    budget_items: budget, guests, vendors, schedule_items: schedule };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${wedding.couple_names.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================= Main budget ================= */
function viewBudget() {
  const f = ui.budgetFilter;
  const all = budgetLines(), t = budgetTotals(all);
  const cats = [...new Set(all.map(b => b.category))];
  const list = all.filter(b =>
    (!f.cat || b.category === f.cat) && (!f.status || b.status === f.status) && (!f.costed || b.cost > 0 || b.deposit > 0 || b.paid > 0) &&
    (!f.q || [b.item, b.provider, b.contact, b.pledged_by, b.feedback].join(" ").toLowerCase().includes(f.q.toLowerCase())));
  const cell = (v, l) => `<td class="num ${v ? "" : "m-hide"}" data-l="${l}">${v ? money(v) : `<span class="zero">–</span>`}</td>`;
  const row = b => `<tr class="click ${b.status === "N/A" ? "is-na" : ""}" data-bud="${b.id}">
    <td class="main">${esc(b.item)}${b.linked === "food" ? `<div class="sub">Worked out from the Food list</div>` : b.linked === "contingency" ? `<div class="sub">10% of every other line</div>` : b.feedback ? `<div class="sub">${esc(b.feedback)}</div>` : ""}</td>
    <td class="opt" data-l="Provider">${esc(b.provider || "")}${b.contact ? `<div class="small">${telLink(b.contact)}</div>` : ""}</td>
    ${cell(b.cost, "Cost")}${cell(b.deposit, "Deposit")}${cell(b.paid, "Paid")}
    <td class="num ${b.balance < 0 ? "neg" : ""} ${b.balance ? "" : "m-hide"}" data-l="Balance">${b.balance ? money(b.balance) : `<span class="zero">–</span>`}</td>
    <td class="num opt" data-l="Pledged">${b.pledged_amount ? `${money(b.pledged_amount)}${b.pledged_by ? `<div class="small muted">${esc(b.pledged_by)}</div>` : ""}` : b.pledged_by ? esc(b.pledged_by) : ""}</td>
    <td data-l="Status">${canWrite() ? statusSelect("data-bstatus", b.id, b.status, BUDGET_STATUSES, `Status of ${b.item}`) : `<span class="pill ${stCls(b.status)}">${esc(b.status)}</span>`}</td>
    ${f.ref ? `<td class="num ref opt" data-l="Last wedding">${b.ref_cost ? money(b.ref_cost) : ""}</td>` : ""}
  </tr>`;
  const groups = [...new Set(list.map(b => b.category))];
  const s = budgetTotals(list);
  const filtered = f.cat || f.status || f.q || f.costed;
  app.innerHTML = `
  ${pageHead("Main budget", "All money in USD. Balance = cost − deposit − amount paid. Lines marked N/A don't count.",
    canWrite() ? `<button class="btn" id="addBud">Add line</button>` : "")}
  <div class="kpis" style="margin-bottom:16px">
    ${kpi("Total estimated cost", money(t.cost), `${plural(all.filter(b => b.cost > 0).length, "line")} costed so far`)}
    ${kpi("Deposits paid", money(t.deposit))}
    ${kpi("Other payments", money(t.paid))}
    ${kpi("Balance owed", money(t.balance), "", { tone: t.balance > 0 ? "warn" : "good" })}
    ${kpi("Covered by pledges", money(t.pledged))}
    ${kpi("Paid so far", `${pct(t.deposit + t.paid, t.cost)}%`, "", { bar: pct(t.deposit + t.paid, t.cost), barCls: "gold" })}
  </div>
  <div class="toolbar">
    <input id="bq" type="search" placeholder="Search items, providers, pledges" value="${esc(f.q)}" aria-label="Search">
    <select id="bc" aria-label="Category">${opts(cats, f.cat, { blank: "All categories" })}</select>
    <select id="bs" aria-label="Status">${opts(BUDGET_STATUSES, f.status, { blank: "Any status" })}</select>
    <label class="check"><input type="checkbox" id="bcost" ${f.costed ? "checked" : ""}> Only lines with money</label>
    <label class="check"><input type="checkbox" id="bref" ${f.ref ? "checked" : ""}> Show last wedding's costs</label>
    <span class="count">${plural(list.length, "line")}</span>
  </div>
  ${list.length ? `<div class="tcard"><table class="tbl">
    <thead><tr><th>Item</th><th>Provider</th><th class="num">Cost</th><th class="num">Deposit</th><th class="num">Paid</th><th class="num">Balance</th><th class="num">Pledged</th><th>Status</th>${f.ref ? `<th class="num">Last wedding</th>` : ""}</tr></thead>
    <tbody>${groups.map(c => {
      const items = list.filter(b => b.category === c), sub = budgetTotals(items);
      return `<tr class="grp"><td colspan="2">${esc(c)}</td><td class="num">${sub.cost ? money(sub.cost) : ""}</td><td class="m-hide" colspan="${f.ref ? 6 : 5}"></td></tr>${items.map(row).join("")}`;
    }).join("")}</tbody>
    <tfoot><tr><td colspan="2" class="main">Total${filtered ? " of the lines shown" : ""}</td>
      <td class="num" data-l="Cost">${money(s.cost)}</td><td class="num" data-l="Deposit">${money(s.deposit)}</td><td class="num" data-l="Paid">${money(s.paid)}</td>
      <td class="num" data-l="Balance">${money(s.balance)}</td><td class="num" data-l="Pledged">${money(s.pledged)}</td><td class="m-hide"></td>${f.ref ? `<td class="num" data-l="Last wedding">${money(s.ref)}</td>` : ""}</tr></tfoot>
  </table></div>` : `<div class="card empty">No budget lines match these filters.</div>`}`;
  bindRows("[data-bud]", tr => editBudget(Number(tr.dataset.bud)));
  app.querySelectorAll("[data-bstatus]").forEach(sel => sel.onchange = async () => {
    await run(sb.from("budget_items").update({ status: sel.value }).eq("id", Number(sel.dataset.bstatus)), "Status saved");
    reload(viewBudget);
  });
  $("bc").onchange = e => { f.cat = e.target.value; viewBudget(); };
  $("bs").onchange = e => { f.status = e.target.value; viewBudget(); };
  $("bcost").onchange = e => { f.costed = e.target.checked; viewBudget(); };
  $("bref").onchange = e => { f.ref = e.target.checked; viewBudget(); };
  searchBox("bq", v => { f.q = v; viewBudget(); });
  $("addBud")?.addEventListener("click", () => editBudget(null));
}

/* Search boxes re-render the page; keep the cursor in the box afterwards */
function searchBox(id, apply) {
  const el = $(id);
  el.oninput = () => {
    clearTimeout(el._t);
    el._t = setTimeout(() => { apply(el.value); const n = $(id); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
  };
}

function editBudget(id) {
  const b = budgetLines().find(x => x.id === id) || { category: ui.budgetFilter.cat || "Other", qty: 1, cost: 0, deposit: 0, paid: 0, pledged_amount: 0, status: "Not started" };
  const cats = [...new Set(S.budget.map(x => x.category))];
  const linkedNote = b.linked === "food" ? "The cost comes from the Food list total. Change it there."
    : b.linked === "contingency" ? "The cost is 10% of every other line, worked out automatically." : "";
  openDialog(`
    <h2>${id ? (canWrite() ? "Edit budget line" : "Budget line") : "New budget line"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <label for="bi">Item</label><input id="bi" name="item" required value="${esc(b.item)}">
    <div class="grid2">
      <div><label for="bcat">Category</label><input id="bcat" name="category" list="bcatList" required value="${esc(b.category)}"></div>
      <div><label for="bst">Status</label><select id="bst" name="status">${opts(BUDGET_STATUSES, b.status)}</select></div>
      <div><label for="bp">Service provider</label><input id="bp" name="provider" value="${esc(b.provider)}"></div>
      <div><label for="bct">Contact</label><input id="bct" name="contact" type="tel" value="${esc(b.contact)}"></div>
    </div>
    <datalist id="bcatList">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div class="grid2">
      <div><label for="bqt">Quantity</label><input id="bqt" name="qty" type="number" step="0.01" min="0" value="${esc(b.qty)}"></div>
      <div><label for="bco">Cost (USD)</label><input id="bco" name="cost" type="number" step="0.01" min="0" value="${esc(b.cost)}" ${b.linked ? "disabled" : ""}></div>
      <div><label for="bde">Deposit</label><input id="bde" name="deposit" type="number" step="0.01" min="0" value="${esc(b.deposit)}"></div>
      <div><label for="bpa">Amount paid after deposit</label><input id="bpa" name="paid" type="number" step="0.01" min="0" value="${esc(b.paid)}"></div>
      <div><label for="bpb">Pledged by</label><input id="bpb" name="pledged_by" value="${esc(b.pledged_by)}"></div>
      <div><label for="bpm">Pledged amount</label><input id="bpm" name="pledged_amount" type="number" step="0.01" min="0" value="${esc(b.pledged_amount)}"></div>
    </div>
    ${linkedNote ? `<p class="small muted">${linkedNote}</p>` : ""}
    <div class="calc" id="bcalc"></div>
    <label for="bfb">Feedback / report</label><textarea id="bfb" name="feedback" style="min-height:60px">${esc(b.feedback)}</textarea>
    <label for="bref2">Same item at a previous wedding (reference only)</label><input id="bref2" name="ref_cost" type="number" step="0.01" min="0" value="${esc(b.ref_cost)}">
    </fieldset>
    ${actionsHtml({ save: id ? "Save line" : "Add line", del: id && !b.linked ? "Delete" : null, cancel: canWrite() ? "Cancel" : "Close" })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this budget line?")) throw new Error("cancelled");
        await run(sb.from("budget_items").delete().eq("id", id), "Line deleted");
      } else {
        const row = clean(fd);
        for (const k of ["qty", "deposit", "paid", "pledged_amount"]) row[k] = Number(row[k] || 0);
        if (b.linked) delete row.cost; else row.cost = Number(row.cost || 0);
        row.ref_cost = num(row.ref_cost);
        if (id) await run(sb.from("budget_items").update(row).eq("id", id), "Line saved");
        else await run(sb.from("budget_items").insert({ ...row, wedding_id: S.wedding.id, sort: nextSort(S.budget) }), "Line added");
      }
      reload(viewBudget);
    }, { readOnly: !canWrite() });
  const calc = () => {
    const cost = b.linked ? b.cost : Number($("bco").value || 0);
    const bal = cost - Number($("bde").value || 0) - Number($("bpa").value || 0);
    $("bcalc").innerHTML = `Balance: <b class="${bal < 0 ? "late" : ""}">${money(bal)}</b>${bal < 0 ? " (more paid than the cost)" : ""}`;
  };
  ["bco", "bde", "bpa"].forEach(i => $(i).addEventListener("input", calc));
  calc();
}

/* ================= Guest list ================= */
const confCls = c => c === "Yes" ? "done" : c === "No" ? "red" : c === "Maybe" ? "prog" : "";

function viewGuests() {
  const f = ui.guestFilter, w = S.wedding;
  const g = guestStats(), cap = w.venue_capacity || w.guest_count;
  const over = cap && g.confirmedPeople > cap;
  const list = S.guests.filter(x =>
    (!f.side || x.side === f.side) &&
    (!f.confirmed || (f.confirmed === "none" ? !x.confirmed : x.confirmed === f.confirmed)) &&
    (!f.q || [x.name, x.relationship, x.phone, x.seating, x.notes].join(" ").toLowerCase().includes(f.q.toLowerCase())));
  const row = (x, i) => `<tr class="click" data-guest="${x.id}">
    <td class="idx">${i + 1}</td>
    <td class="main">${esc(x.name)}</td>
    <td class="opt" data-l="Side">${esc(x.side || "")}</td>
    <td class="opt" data-l="Relationship">${esc(x.relationship || "")}</td>
    <td class="opt" data-l="Phone">${telLink(x.phone)}</td>
    <td data-l="Confirmed">${canWrite()
      ? `<select class="st ${confCls(x.confirmed)}" data-gconf="${x.id}" aria-label="Confirmed: ${esc(x.name)}">${opts(["Yes", "Maybe", "No"], x.confirmed, { blank: "No reply" })}</select>`
      : `<span class="pill ${confCls(x.confirmed)}">${esc(x.confirmed || "No reply")}</span>`}</td>
    <td class="num" data-l="People">${x.people}</td>
    <td data-l="Parking">${x.needs_parking ? "Yes" : `<span class="zero">No</span>`}</td>
    <td class="opt" data-l="Seating">${esc(x.seating || "")}</td>
    <td class="opt m-hide" data-l="Notes"><div class="clip">${esc(x.notes || "")}</div></td>
  </tr>`;
  app.innerHTML = `
  ${pageHead("Guest list", `${cap ? `The venue seats ${esc(cap)}. ` : ""}Track replies and who's driving (parking is limited).`,
    canWrite() ? `<button class="btn ghost" id="addMany">Add many</button><button class="btn" id="addGuest">Add guest</button>` : "")}
  <div class="kpis" style="margin-bottom:16px">
    ${kpi("Confirmed people", `${g.confirmedPeople}${cap ? ` <small>/ ${cap}</small>` : ""}`,
      cap ? (over ? `<span class="late">${g.confirmedPeople - cap} over capacity</span>` : `${cap - g.confirmedPeople} seats left`) : "",
      { bar: cap ? pct(g.confirmedPeople, cap) : null, barCls: over ? "red" : "", tone: over ? "bad" : "" })}
    ${kpi("On the list", g.entries, `${g.invitedPeople} ${g.invitedPeople === 1 ? "person" : "people"} in total`)}
    ${kpi("Awaiting reply", g.awaiting, "No reply yet, or maybe", { tone: g.awaiting ? "warn" : "" })}
    ${kpi("Declined", g.declined)}
    ${kpi("Cars expected", g.cars, "Confirmed guests who need parking")}
  </div>
  <div class="toolbar">
    <input id="gq" type="search" placeholder="Search names, phone, seating, notes" value="${esc(f.q)}" aria-label="Search">
    <select id="gs" aria-label="Side">${opts(SIDES, f.side, { blank: "Every side" })}</select>
    <select id="gc" aria-label="Reply">${opts([{ value: "Yes", label: "Confirmed" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "Declined" }, { value: "none", label: "No reply" }], f.confirmed, { blank: "Any reply" })}</select>
    <span class="count">${plural(list.length, "entry")}</span>
  </div>
  ${!S.guests.length ? `<div class="card empty">No guests yet.${canWrite() ? " Add them one at a time, or use <b>Add many</b> to paste a list of names." : ""}</div>`
    : list.length ? `<div class="tcard"><table class="tbl">
    <thead><tr><th>#</th><th>Name</th><th>Side</th><th>Relationship</th><th>Phone</th><th>Confirmed</th><th class="num">People</th><th>Parking</th><th>Seating</th><th>Notes</th></tr></thead>
    <tbody>${list.map(row).join("")}</tbody>
  </table></div>` : `<div class="card empty">No guests match these filters.</div>`}`;
  bindRows("[data-guest]", tr => editGuest(Number(tr.dataset.guest)));
  app.querySelectorAll("[data-gconf]").forEach(sel => sel.onchange = async () => {
    await run(sb.from("guests").update({ confirmed: sel.value || null }).eq("id", Number(sel.dataset.gconf)), "Reply saved");
    reload(viewGuests);
  });
  $("gs").onchange = e => { f.side = e.target.value; viewGuests(); };
  $("gc").onchange = e => { f.confirmed = e.target.value; viewGuests(); };
  searchBox("gq", v => { f.q = v; viewGuests(); });
  $("addGuest")?.addEventListener("click", () => editGuest(null));
  $("addMany")?.addEventListener("click", addManyGuests);
}

function editGuest(id, defaults = {}) {
  const x = S.guests.find(g => g.id === id) || { people: 1, needs_parking: false, ...defaults };
  const seats = ["Couches (elders)", "High table", "VIP", ...S.guests.map(g => g.seating).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);
  const rels = [...new Set(S.guests.map(g => g.relationship).filter(Boolean))];
  openDialog(`
    <h2>${id ? (canWrite() ? "Edit guest" : "Guest") : "Add guest"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <label for="gn">Name</label><input id="gn" name="name" required value="${esc(x.name)}" placeholder="e.g. Mr & Mrs Moyo">
    <div class="grid2">
      <div><label for="gsd">Side</label><select id="gsd" name="side">${opts(SIDES, x.side, { blank: "Not set" })}</select></div>
      <div><label for="grl">Relationship</label><input id="grl" name="relationship" list="relList" value="${esc(x.relationship)}" placeholder="Aunt, colleague, church…"></div>
      <div><label for="gph">Phone</label><input id="gph" name="phone" type="tel" value="${esc(x.phone)}"></div>
      <div><label for="gcf">Confirmed</label><select id="gcf" name="confirmed">${opts(["Yes", "Maybe", "No"], x.confirmed, { blank: "No reply yet" })}</select></div>
      <div><label for="gpp">Number of people</label><input id="gpp" name="people" type="number" min="0" value="${esc(x.people)}"></div>
      <div><label for="gse">Seating</label><input id="gse" name="seating" list="seatList" value="${esc(x.seating)}" placeholder="Couches (elders), Table 4…"></div>
    </div>
    <datalist id="relList">${rels.map(r => `<option value="${esc(r)}">`).join("")}</datalist>
    <datalist id="seatList">${seats.map(v => `<option value="${esc(v)}">`).join("")}</datalist>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="needs_parking" ${x.needs_parking ? "checked" : ""}> Needs parking (coming by car)</label>
    <label for="gno">Notes</label><input id="gno" name="notes" value="${esc(x.notes)}">
    </fieldset>
    <div class="actions">${canWrite() ? `<button class="btn" value="save">${id ? "Save guest" : "Add guest"}</button>${id ? "" : `<button class="btn ghost" value="saveadd">Add and start another</button>`}` : ""}
      <button class="btn ghost" value="cancel" formnovalidate>${canWrite() ? "Cancel" : "Close"}</button>
      ${id && canWrite() ? `<button class="btn danger left" value="delete" formnovalidate>Delete</button>` : ""}</div>`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm(`Remove ${x.name} from the guest list?`)) throw new Error("cancelled");
        await run(sb.from("guests").delete().eq("id", id), "Guest removed");
        reload(viewGuests);
        return;
      }
      const row = clean(fd);
      row.people = Number(row.people ?? 1);
      row.needs_parking = fd.needs_parking === "on";
      if (id) await run(sb.from("guests").update(row).eq("id", id), "Guest saved");
      else await run(sb.from("guests").insert({ ...row, wedding_id: S.wedding.id, sort: nextSort(S.guests) }), "Guest added");
      const again = action === "saveadd";
      reload(viewGuests).then(() => { if (again) editGuest(null, { side: row.side, relationship: row.relationship }); });
    }, { readOnly: !canWrite() });
}

function addManyGuests() {
  openDialog(`
    <h2>Add many guests</h2>
    <p class="small muted">One guest (or couple) per line. Add a phone number after a comma, for example <i>Mr &amp; Mrs Moyo, 0772 123 456</i>. Start a line with "2 x" to count two people.</p>
    <div class="grid2">
      <div><label for="mside">Side</label><select id="mside" name="side">${opts(SIDES, "", { blank: "Not set" })}</select></div>
      <div><label for="mrel">Relationship (optional)</label><input id="mrel" name="relationship"></div>
    </div>
    <label for="mlist">Names</label><textarea id="mlist" name="list" required style="min-height:220px" placeholder="Mr &amp; Mrs Moyo, 0772 123 456&#10;Tendai Chikore&#10;2 x Mukusha family"></textarea>
    ${actionsHtml({ save: "Add guests" })}`,
    async fd => {
      const start = nextSort(S.guests);
      const rows = fd.list.split(/\n+/).map(l => l.trim()).filter(Boolean).map((l, i) => {
        let people = 1;
        const m = l.match(/^(\d+)\s*x\s+(.*)$/i);
        if (m) { people = Number(m[1]); l = m[2]; }
        const parts = l.split(",").map(p => p.trim());
        const phone = parts.length > 1 && /^[+\d][\d\s-]{5,}$/.test(parts[parts.length - 1]) ? parts.pop() : null;
        return { wedding_id: S.wedding.id, name: parts.join(", "), phone, people, side: fd.side || null,
          relationship: fd.relationship?.trim() || null, sort: start + i };
      }).filter(r => r.name);
      if (!rows.length) { toast("Type at least one name", true); throw new Error("empty"); }
      await run(sb.from("guests").insert(rows), `${plural(rows.length, "guest")} added`);
      reload(viewGuests);
    });
}

/* ================= Vendors ================= */
function viewVendors() {
  const booked = S.vendors.filter(v => v.name).length, confirmed = S.vendors.filter(v => v.confirmed).length;
  const row = v => `<tr class="click" data-ven="${v.id}">
    <td class="main">${esc(v.service)}</td>
    <td data-l="Name">${v.name ? esc(v.name) : `<span class="pill red">Not booked</span>`}</td>
    <td class="opt" data-l="Phone">${telLink(v.phone)}</td>
    <td class="opt nowrap" data-l="Booked on">${v.date_booked ? esc(fmtDate(v.date_booked, { day: "numeric", month: "short" })) : ""}</td>
    <td class="opt nowrap" data-l="Arrives on the day">${esc(v.arrival_time || "")}</td>
    <td class="chk" data-l="Confirmed a week before"><input type="checkbox" data-vconf="${v.id}" ${v.confirmed ? "checked" : ""} ${canWrite() ? "" : "disabled"} aria-label="Confirmed: ${esc(v.service)}"></td>
    <td class="opt m-hide" data-l="Notes"><div class="clip">${esc(v.notes || "")}</div></td>
  </tr>`;
  app.innerHTML = `
  ${pageHead("Vendors & helpers", "One place for every phone number you'll need on the day. Confirm each one a week before.",
    `<button class="btn ghost" id="shareVen">Share list</button>${canWrite() ? `<button class="btn" id="addVen">Add vendor</button>` : ""}`)}
  <div class="kpis" style="margin-bottom:16px">
    ${kpi("Booked", `${booked} <small>/ ${S.vendors.length}</small>`, "", { bar: pct(booked, S.vendors.length) })}
    ${kpi("Still to book", S.vendors.length - booked, "", { tone: S.vendors.length - booked ? "warn" : "good" })}
    ${kpi("Confirmed a week before", `${confirmed} <small>/ ${S.vendors.length}</small>`,
      daysToGo(S.wedding) <= 7 && confirmed < booked ? `<span class="late">The wedding is this week</span>` : "", { bar: pct(confirmed, S.vendors.length), barCls: "gold" })}
  </div>
  ${S.vendors.length ? `<div class="tcard"><table class="tbl">
    <thead><tr><th>Service</th><th>Name</th><th>Phone</th><th>Booked on</th><th>Arrives on the day</th><th>Confirmed</th><th>Notes</th></tr></thead>
    <tbody>${S.vendors.map(row).join("")}</tbody></table></div>` : `<div class="card empty">No vendors yet.</div>`}`;
  bindRows("[data-ven]", tr => editVendor(Number(tr.dataset.ven)));
  app.querySelectorAll("[data-vconf]").forEach(c => c.onchange = async () => {
    await run(sb.from("vendors").update({ confirmed: c.checked }).eq("id", Number(c.dataset.vconf)), c.checked ? "Marked confirmed" : "Marked not confirmed");
    reload(viewVendors);
  });
  $("addVen")?.addEventListener("click", () => editVendor(null));
  $("shareVen").onclick = () => {
    const w = S.wedding;
    const L = [`*${w.couple_names} wedding – vendor & helper contacts*`, fmtLong(w.wedding_date), ""];
    S.vendors.filter(v => v.name || v.phone).forEach(v =>
      L.push(`*${v.service}:* ${[v.name, v.phone, v.arrival_time && `arrives ${v.arrival_time}`].filter(Boolean).join(" · ")}`));
    if (L.length === 3) L.push("No vendors booked yet.");
    shareTextDialog("Share vendor list", L.join("\n"));
  };
}

function editVendor(id) {
  const v = S.vendors.find(x => x.id === id) || { confirmed: false };
  openDialog(`
    <h2>${id ? (canWrite() ? "Edit vendor" : "Vendor") : "Add vendor"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <label for="vs">Service</label><input id="vs" name="service" required value="${esc(v.service)}" placeholder="e.g. Photographer">
    <div class="grid2">
      <div><label for="vn">Name</label><input id="vn" name="name" value="${esc(v.name)}"></div>
      <div><label for="vp">Phone</label><input id="vp" name="phone" type="tel" value="${esc(v.phone)}"></div>
      <div><label for="vd">Date booked</label><input id="vd" name="date_booked" type="date" value="${esc(v.date_booked)}"></div>
      <div><label for="va">Arrival time on the day</label><input id="va" name="arrival_time" type="time" value="${esc(v.arrival_time)}"></div>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="confirmed" ${v.confirmed ? "checked" : ""}> Confirmed (one week before)</label>
    <label for="vno">Notes</label><textarea id="vno" name="notes" style="min-height:60px">${esc(v.notes)}</textarea>
    </fieldset>
    ${actionsHtml({ save: id ? "Save vendor" : "Add vendor", del: id ? "Delete" : null, cancel: canWrite() ? "Cancel" : "Close" })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm(`Delete ${v.service}?`)) throw new Error("cancelled");
        await run(sb.from("vendors").delete().eq("id", id), "Vendor deleted");
      } else {
        const row = clean(fd);
        row.confirmed = fd.confirmed === "on";
        if (id) await run(sb.from("vendors").update(row).eq("id", id), "Vendor saved");
        else await run(sb.from("vendors").insert({ ...row, wedding_id: S.wedding.id, sort: nextSort(S.vendors) }), "Vendor added");
      }
      reload(viewVendors);
    }, { readOnly: !canWrite() });
}

/* ================= Day schedule ================= */
function scheduleDays() {
  const days = [...new Set([...DAYS, ...S.schedule.map(s => s.day)])];
  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99") || a.sort - b.sort;
  return days.map(d => ({ day: d, items: S.schedule.filter(s => s.day === d).sort(byTime) }))
    .filter(d => d.items.length || DAYS.includes(d.day));
}
function scheduleDate(day) {
  const w = S.wedding;
  return day === "Wedding day" ? fmtLong(w.wedding_date) : day === "Day before" ? fmtLong(addDays(w.wedding_date, -1)) : "";
}
function viewSchedule() {
  app.innerHTML = `
  ${pageHead("Day schedule", "Change the times to fit your programme, then share it with vendors one week before.",
    `<button class="btn ghost" id="shareSch">Share or print</button>${canWrite() ? `<button class="btn" id="addSch">Add item</button>` : ""}`)}
  <div class="stack">${scheduleDays().map(({ day, items }) => `
    <div class="card flush">
      <div class="card-h"><h2>${esc(day)}</h2><span class="small muted">${esc(scheduleDate(day))}</span></div>
      <div class="tcard" style="border:0;border-radius:0"><table class="tbl">
      <thead><tr><th style="width:80px">Time</th><th>Activity</th><th>Where</th><th>Who</th><th>Notes</th></tr></thead>
      <tbody>${items.length ? items.map(s => `<tr class="click" data-sch="${s.id}">
        <td class="lead nowrap"><b>${esc(s.time || "–")}</b></td>
        <td class="main">${esc(s.activity)}</td>
        <td class="opt" data-l="Where">${esc(s.place || "")}</td>
        <td class="opt" data-l="Who">${esc(s.who || "")}</td>
        <td class="opt" data-l="Notes">${esc(s.notes || "")}</td></tr>`).join("")
        : `<tr><td colspan="5" class="muted">Nothing planned yet.</td></tr>`}</tbody>
      </table></div>
    </div>`).join("")}</div>`;
  bindRows("[data-sch]", tr => editSchedule(Number(tr.dataset.sch)));
  $("addSch")?.addEventListener("click", () => editSchedule(null));
  $("shareSch").onclick = () => shareTextDialog("Share day schedule", scheduleText(), { onPrint: printSchedule });
}
function scheduleText() {
  const w = S.wedding;
  const L = [`*${w.couple_names} wedding – day schedule*`, [w.venue, w.venue_address].filter(Boolean).join(", ")];
  scheduleDays().forEach(({ day, items }) => {
    if (!items.length) return;
    L.push("", `*${day.toUpperCase()}*${scheduleDate(day) ? ` (${scheduleDate(day)})` : ""}`);
    items.forEach(s => L.push(`${s.time || "--:--"}  ${s.activity}${s.place ? ` – ${s.place}` : ""}${s.who ? ` (${s.who})` : ""}${s.notes ? `. ${s.notes}` : ""}`));
  });
  return L.join("\n");
}
function printSchedule() {
  const w = S.wedding;
  $("printArea").innerHTML = `<h1>${esc(w.couple_names)} – wedding day schedule</h1>
    <div class="meta">${esc([fmtLong(w.wedding_date), w.ceremony_time, w.venue, w.venue_address].filter(Boolean).join(" · "))}</div>
    ${scheduleDays().filter(d => d.items.length).map(({ day, items }) => `<h2>${esc(day)}${scheduleDate(day) ? ` – ${esc(scheduleDate(day))}` : ""}</h2>
      <table><tr><th style="width:52pt">Time</th><th>Activity</th><th>Where</th><th>Who</th><th>Notes</th></tr>
      ${items.map(s => `<tr><td>${esc(s.time || "")}</td><td>${esc(s.activity)}</td><td>${esc(s.place || "")}</td><td>${esc(s.who || "")}</td><td>${esc(s.notes || "")}</td></tr>`).join("")}</table>`).join("")}`;
  window.print();
}
function editSchedule(id) {
  const s = S.schedule.find(x => x.id === id) || { day: "Wedding day" };
  const days = [...new Set([...DAYS, ...S.schedule.map(x => x.day)])];
  openDialog(`
    <h2>${id ? (canWrite() ? "Edit schedule item" : "Schedule item") : "Add to the schedule"}</h2>
    <fieldset ${canWrite() ? "" : "disabled"}>
    <div class="grid2">
      <div><label for="sd">Day</label><input id="sd" name="day" list="dayList" required value="${esc(s.day)}"></div>
      <div><label for="stm">Time</label><input id="stm" name="time" type="time" value="${esc(s.time)}"></div>
    </div>
    <datalist id="dayList">${days.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
    <label for="sa">Activity</label><input id="sa" name="activity" required value="${esc(s.activity)}">
    <div class="grid2">
      <div><label for="sw">Where</label><input id="sw" name="place" value="${esc(s.place)}"></div>
      <div><label for="swh">Who</label><input id="swh" name="who" value="${esc(s.who)}"></div>
    </div>
    <label for="sn">Notes</label><input id="sn" name="notes" value="${esc(s.notes)}">
    </fieldset>
    ${actionsHtml({ save: id ? "Save" : "Add", del: id ? "Delete" : null, cancel: canWrite() ? "Cancel" : "Close" })}`,
    async (fd, action) => {
      if (action === "delete") {
        if (!confirm("Delete this schedule item?")) throw new Error("cancelled");
        await run(sb.from("schedule_items").delete().eq("id", id), "Item deleted");
      } else {
        const row = clean(fd);
        if (id) await run(sb.from("schedule_items").update(row).eq("id", id), "Schedule saved");
        else await run(sb.from("schedule_items").insert({ ...row, wedding_id: S.wedding.id, sort: nextSort(S.schedule) }), "Added to the schedule");
      }
      reload(viewSchedule);
    }, { readOnly: !canWrite() });
}
