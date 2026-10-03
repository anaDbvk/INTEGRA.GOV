"use strict";
const $screen = document.getElementById("screen");
const $nav = document.getElementById("nav");
const $toast = document.getElementById("toast");
const root = document.documentElement;

const state = {
  authenticated: false,
  recoveryAvailable: false,
  page: "login",
  history: [],
  sources: [],
  journeys: [],
  current: null,
  stepIndex: 0,
  alerts: [],
  tab: "active",
  language: detectLanguage(),
  loginError: "",
  loginStep: "start",
  openAcc: "prefs",
  createdFor: null,
  focus: [],
  showReminder: false,
  reminderJourney: "",
  busy: false,
};

const LANG_KEY = "smartin_lang";
function detectLanguage() {
  const supported = ["en", "pl", "uk"];
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage unavailable */ }
  if (supported.includes(saved)) return saved;
  const wanted = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]);
  for (const tag of wanted) {
    const base = String(tag || "").toLowerCase().split("-")[0];
    if (supported.includes(base)) return base;
  }
  return "en";
}
function t(key, vars = {}) {
  const dict = window.I18N || {};
  let value = (dict[state.language] || {})[key] ?? (dict.en || {})[key] ?? key;
  if (value && typeof value === "object") {
    const n = Number(vars.n ?? vars.count ?? 0);
    let cat = "other";
    try { cat = new Intl.PluralRules(state.language).select(n); } catch { cat = n === 1 ? "one" : "other"; }
    value = value[cat] ?? value.other;
  }
  return String(value).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
function setLanguage(lang) {
  if (!["en", "pl", "uk"].includes(lang)) return;
  state.language = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage unavailable */ }
  root.lang = lang;
  render();
}

const PREFS_KEY = "smartin_prefs";
const prefs = Object.assign(
  { textSize: "default", contrast: false, motion: false, deadlines: true },
  safeJson(localStorage.getItem(PREFS_KEY)),
);
function safeJson(text) { try { return JSON.parse(text) || {}; } catch { return {}; } }
function applyPrefs() {
  root.classList.toggle("text-sm", prefs.textSize === "small");
  root.classList.toggle("text-lg", prefs.textSize === "large");
  root.classList.toggle("hc", prefs.contrast);
  root.classList.toggle("rm", prefs.motion);
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
applyPrefs();
root.lang = state.language;

const ICONS = {
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  home: "M4 10l8-6 8 6v10H4zM10 20v-5h4v5",
  compass: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  user: "M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM4 21a8 8 0 0 1 16 0",
  check: "M5 12l5 5 9-10",
  clock: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8v4l3 2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  scales: "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z",
  briefcase: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  shop: "M4 10h16l-1.5-5h-13zM5 10v10h14V10M10 20v-5h4v5",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9H3zM3 7l12-3v3M16 13h2",
  family: "M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M16 14a5 5 0 0 1 5 6",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5",
  language: "M4 5h8M8 3v2M6 5c0 4 3 7 6 8M10 5c0 4-3 7-6 8M13 21l4-9 4 9M14.5 18h5",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10zM8 12h2l1-2 2 4 1-2h2",
  search: "M11 18a7 7 0 1 0 0-14a7 7 0 1 0 0 14zM20 20l-4-4",
  pin: "M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  mic: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  send: "M4 12l16-8-6 16-3-7z",
  back: "M15 5l-7 7 7 7",
  chev: "M6 9l6 6 6-6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  tv: "M5 4h14v12H5zM5 11h14M8 19v-3M16 19v-3",
  shieldcheck: "M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  phone: "M8 3h8v18H8zM11 18h2",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  plus: "M12 5v14M5 12h14",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v5M12 8v.5",
  help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5",
  idcard: "M3 6h18v12H3zM7 10h4M7 14h6M15 10h2v4h-2z",
};

function icon(name, size = 22, color = "currentColor", width = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ICONS.doc}"/></svg>`;
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

function toast(message) {
  $toast.textContent = message;
  $toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $toast.classList.remove("show"), 3600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, body, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || t("err.request", { code: response.status }));
    error.status = response.status;
    if (response.status === 401 && path !== "/api/session") {
      state.authenticated = false;
      state.recoveryAvailable = true;
      state.loginStep = "phone";
      state.loginError = t("err.expired");
      go("login");
    }
    throw error;
  }
  return payload;
}

/* ---------- helpers ---------- */
const FOCUS = {
  first: { label: "focus.first", icon: "flag", c: "#2A5BD7", t: "#E6EEFD", words: /pesel|residen|permit|registr|visa|passport|document|arriv|first/i },
  housing: { label: "focus.housing", icon: "home", c: "#EE7F3A", t: "#FDEDE2", words: /rent|flat|apartment|housing|landlord|lease|address|meldun/i },
  finance: { label: "focus.finance", icon: "wallet", c: "#52771F", t: "#EAF1DF", words: /bank|tax|pit|money|finance|zus|salary|account|income/i },
  health: { label: "focus.health", icon: "heart", c: "#C73E38", t: "#FDE8E7", words: /health|nfz|insur|doctor|hospital|medic/i },
  safety: { label: "focus.safety", icon: "shield", c: "#6227A5", t: "#EFE7F8", words: /safe|police|rights|emergen|legal|fraud/i },
};

function blocksOf(record) { return (record?.journey?.journey_blocks) || []; }
function completedOf(record) { return new Set(record?.completed_steps || []); }
function percent(record) {
  const total = blocksOf(record).length;
  return total ? Math.round((completedOf(record).size / total) * 100) : 0;
}
function inferFocus(record) {
  const saved = record?.journey?.focus;
  if (Array.isArray(saved) && saved.length) return saved.filter((key) => FOCUS[key]);
  const text = blocksOf(record).map((b) => `${b.title} ${b.action}`).join(" ") + ` ${record?.title || ""} ${record?.goal || ""}`;
  const found = Object.keys(FOCUS).filter((key) => FOCUS[key].words.test(text));
  return found.length ? found.slice(0, 5) : ["first"];
}
function formatDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatFull(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDay(d)}.${d.getFullYear()}`;
}
function relTime(value) {
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t("alerts.now");
  if (mins < 60) return t("alerts.min", { count: mins });
  if (mins < 1440) return t("alerts.h", { count: Math.round(mins / 60) });
  return formatDay(d);
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
}
function stepStatus(record, index) {
  const done = completedOf(record);
  if (done.has(index)) return "done";
  const first = blocksOf(record).findIndex((_, i) => !done.has(i));
  return first === index ? "progress" : "todo";
}
function pill(status) {
  if (status === "done") return `<span class="pill done">${icon("check", 12, "currentColor", 3)}${t("pill.done")}</span>`;
  if (status === "progress") return `<span class="pill progress"><svg width="8" height="8"><circle cx="4" cy="4" r="4" fill="#EE7F3A"/></svg>${t("pill.progress")}</span>`;
  return `<span class="pill todo"><i style="width:7px;height:7px;border-radius:4px;border:1.5px solid #5F6685"></i>${t("pill.todo")}</span>`;
}
function unreadCount() { return state.alerts.filter((a) => !a.is_read).length; }

/* ---------- chrome ---------- */
const NAV_PAGES = new Set(["journeys", "journey", "explore", "alerts", "profile"]);
function renderNav() {
  const show = state.authenticated && NAV_PAGES.has(state.page);
  $nav.classList.toggle("hidden", !show);
  if (!show) { $nav.innerHTML = ""; return; }
  const active = state.page === "journey" ? "journeys" : state.page;
  const badge = unreadCount();
  const item = (key, label, ic) => `<button type="button" data-go="${key}" class="${active === key ? "on" : ""}" ${active === key ? 'aria-current="page"' : ""}>
    <span class="pillbox">${icon(ic, 22)}${key === "alerts" && badge ? `<span class="badge">${badge > 9 ? "9+" : badge}</span>` : ""}</span>${label}</button>`;
  $nav.className = "nav";
  $nav.innerHTML = `${item("journeys", t("nav.journeys"), "flag")}${item("explore", t("nav.explore"), "compass")}
    <button type="button" class="fab" data-go="home" aria-label="${t("nav.ask")}">${icon("sparkle", 26, "#fff")}</button>
    ${item("alerts", t("nav.alerts"), "bell")}${item("profile", t("nav.profile"), "user")}`;
}

function view(html, { locked = false } = {}) {
  $screen.classList.toggle("locked", locked);
  $screen.innerHTML = html;
  $screen.scrollTop = 0;
  renderNav();
}

function backRow(target, title = "") {
  return `<div class="back-row"><button class="icon-btn" type="button" data-go="${target}" aria-label="${t("back")}">${icon("back")}</button><div class="title">${esc(title)}</div><div class="spacer"></div></div>`;
}

function go(page, extra = {}) {
  Object.assign(state, extra, { page });
  render();
}

/* ---------- screens ---------- */
const LOGIN_INFO = { privacy: "info.privacy", accessibility: "info.accessibility", help: "info.help" };
const LANGS = window.LANGUAGES || [{ code: "en", short: "EN", name: "English" }, { code: "pl", short: "PL", name: "Polski" }, { code: "uk", short: "UA", name: "Українська" }];
function langShort() { return (LANGS.find((l) => l.code === state.language) || LANGS[0]).short; }
function langPicker() {
  if (!state.langOpen) return "";
  return `<div class="lang-menu" role="menu">${LANGS.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.code === state.language}" data-lang="${l.code}"><b>${l.short}</b>${esc(l.name)}${l.code === state.language ? icon("check", 16, "#2A5BD7", 2.6) : ""}</button>`).join("")}</div>`;
}

function renderLogin() {
  if (state.loginStep === "phone") return renderPhoneStep();
  const tiles = [["#EC625C", "home"], ["#52771F", "heart"], ["#6227A5", "cap"], ["#EE7F3A", "briefcase"], ["#6EA1F8", "tv"], ["#1B2A5C", "shieldcheck"]];
  view(`<div class="page">
    <div class="login-top"><div class="login-brand"><span class="flag"><i></i><i></i></span>${t("brand")}</div>
      <div class="lang-wrap"><button class="lang-btn" type="button" data-act="lang" aria-haspopup="menu" aria-expanded="${!!state.langOpen}" aria-label="${t("lang.change")}: ${langShort()}">${icon("globe", 18)}${langShort()}</button>${langPicker()}</div></div>
    <div class="tiles6">${tiles.map(([c, i]) => `<div style="background:${c}">${icon(i, 36, "#fff", 1.7)}</div>`).join("")}</div>
    <div class="login-copy"><h1>Witaj</h1><p>${t("login.sub")}</p></div>
    <div class="login-form">
      <button class="btn btn-primary" type="button" data-act="login-phone" style="gap:12px"><span class="g-badge">${icon("phone", 18, "#2A5BD7", 2)}</span><span>${t("login.phone")}</span></button>
      <button class="btn btn-outline" type="button" data-act="login-phone">${icon("user", 20)}${t("login.device")}</button>
      <button class="btn-text" type="button" data-act="login-phone" style="align-self:center">${t("login.create")}</button>
    </div>
    <div class="login-foot">
      <div class="gdpr">${icon("lock", 15, "#5F6685")}${t("login.gdpr")}</div>
      <div class="links"><button type="button" data-info="privacy">${t("login.privacy")}</button><button type="button" data-info="accessibility">${t("login.accessibility")}</button><button type="button" data-info="help">${t("login.help")}</button></div>
    </div></div>`);
}

function renderPhoneStep() {
  view(`<div class="page">
    <div class="back-row"><button class="icon-btn" type="button" data-act="login-back" aria-label="${t("back")}">${icon("back")}</button><div class="title"></div><div class="spacer"></div></div>
    <div class="login-copy" style="padding-top:12px"><h1 style="font-size:32px">${state.recoveryAvailable ? t("phone.titleBack") : t("phone.titleNew")}</h1>
      <p>${state.recoveryAvailable ? t("phone.subBack") : t("phone.subNew")}</p></div>
    <form class="login-form" id="loginForm">
      <label class="field"><span>${t("phone.label")}</span>
      <input class="input" id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+48 600 000 000" maxlength="24" required></label>
      <p class="error" id="loginError" role="alert">${esc(state.loginError)}</p>
      <button class="btn btn-primary" type="submit">${t("continue")}</button>
    </form>
    <div class="login-foot">
      <div class="gdpr">${icon("lock", 15, "#5F6685")}${t("login.gdpr")}</div>
      <p class="note">${t("info.privacy")} ${t("phone.sessions")}</p>
    </div></div>`);
  document.getElementById("phone").focus();
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const error = document.getElementById("loginError");
    button.disabled = true;
    error.textContent = "";
    try {
      await api("/api/session", { method: "POST", body: { phone: document.getElementById("phone").value } });
      state.authenticated = true;
      state.recoveryAvailable = false;
      state.loginError = "";
      state.loginStep = "start";
      await loadAll();
      go("home");
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      button.disabled = false;
    }
  });
}

function renderHome() {
  const topics = ["pesel", "residence", "health", "rent"];
  view(`<div class="page">
    <div class="wl-head"><div class="hello">Dzień dobry</div>
      <button class="icon-btn bell" type="button" data-go="alerts" aria-label="${t("nav.alerts")}">${icon("bell")}${unreadCount() ? '<span class="dot"></span>' : ""}</button></div>
    <h1 class="wl-title">${t("home.title")}</h1>
    <div class="wl-cards">
      <button class="card-blue" type="button" data-act="new-chat"><div class="top"><span class="ico">${icon("sparkle", 24, "#fff")}</span><span class="rec">${t("home.rec")}</span></div>
        <div><div class="t">${t("home.designT")}</div><div class="d" style="margin-top:6px">${t("home.designD")}</div></div>
        <span class="go">${t("home.start")} ${icon("arrow", 18)}</span></button>
      <button class="card-white" type="button" data-go="explore"><span class="ico">${icon("compass", 24, "#1B2A5C")}</span>
        <span><div class="t">${t("home.browseT")}</div><div class="d">${t("home.browseD")}</div></span></button>
    </div>
    <div class="topics"><div class="eyebrow">${t("home.popular")}</div><div class="chips">${topics.map((k) => `<button class="chip" type="button" data-topic="${esc(t(`topic.${k}.q`))}">${esc(t(`topic.${k}`))}</button>`).join("")}</div></div>
    <div class="trust">${icon("shield", 20, "#3F5E16")}<span>${t("home.trust")}</span></div>
  </div>`);
}

function sourcesBlock(sources) {
  if (!sources?.length) return "";
  return `<details class="src"><summary>${icon("shield", 14, "#52771F")}${t("chat.sources")} · <b>${t("chat.view")}</b></summary><ul>${sources.map((s) =>
    `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">[${esc(s.id)}] ${esc(s.title)}</a></li>`).join("")}</ul></details>`;
}

function renderChat() {
  const userTurns = state.history.filter((m) => m.role === "user").length;
  const empty = !state.history.length && !state.busy;
  const bubbles = state.history.map((m, i) => {
    const last = i === state.history.length - 1 && m.role === "assistant";
    return m.role === "user"
      ? `<div class="bubble me">${esc(m.content)}</div>`
      : `<div class="bubble bot">${esc(m.content)}${last ? sourcesBlock(state.sources) : ""}</div>`;
  });
  if (userTurns >= 2) {
    bubbles.push(`<button class="bubble bot create" style="max-width:286px;align-self:flex-start;background:var(--blue);color:#fff;border:0;display:flex;justify-content:center;gap:8px;align-items:center;cursor:pointer;font-weight:600" type="button" data-act="create">${icon("sparkle", 18, "#fff")}${t("chat.create")}</button>`);
  }
  view(`<div class="page fill">
    <div class="chat-head"><button class="back" type="button" data-go="home" aria-label="${t("back")}">${icon("back")}</button>
      <span class="avatar">${icon("sparkle", 20, "#fff")}</span>
      <div class="who"><div class="name">${t("chat.name")}</div><div class="status"><i></i>${t("chat.status")}</div></div>
      ${state.history.length ? `<button class="back" type="button" data-act="new-chat" aria-label="${t("chat.newChat")}">${icon("plus")}</button>` : ""}</div>
    <div class="chat-body ${empty ? "is-empty" : ""}" id="chatBody" aria-live="polite">${bubbles.join("")}</div>
    <div class="composer"><form id="chatForm" autocomplete="off">
      <button class="icon-btn" type="button" data-act="mic" aria-label="${t("chat.mic")}" style="background:var(--bg)">${icon("mic", 20)}</button>
      <input class="msg" id="chatInput" maxlength="2000" placeholder="${t("chat.placeholder")}" aria-label="${t("chat.message")}" enterkeyhint="send">
      <button class="send" id="sendBtn" type="submit" aria-label="${t("chat.send")}">${icon("send", 20, "#fff")}</button></form>
      <div class="fine">${t("chat.fine")}</div></div></div>`, { locked: true });
  const body = document.getElementById("chatBody");
  body.scrollTop = body.scrollHeight;
  document.getElementById("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (text) sendChat(text);
  });
}

function startNewChat() {
  state.history = [];
  state.sources = [];
  api("/api/conversation", { method: "PUT", body: { history: [] } }).catch(() => {});
  go("chat");
  document.getElementById("chatInput")?.focus();
}

async function sendChat(answer) {
  if (state.busy) return;
  state.busy = true;
  const prior = state.history.slice(-12);
  state.history.push({ role: "user", content: answer });
  state.sources = [];
  renderChat();
  const body = document.getElementById("chatBody");
  body.insertAdjacentHTML("beforeend", '<div class="bubble bot" id="typing"><div class="typing"><i></i><i></i><i></i></div></div>');
  body.scrollTop = body.scrollHeight;
  document.getElementById("chatInput").disabled = true;
  document.getElementById("sendBtn").disabled = true;
  try {
    const result = await api("/api/interview", { method: "POST", body: { answer, history: prior, language: state.language } });
    const text = result.outcome === "interview" ? `${result.message}\n\n${result.question}` : result.message;
    state.history.push({ role: "assistant", content: text });
    state.sources = result.sources || [];
    if (result.outcome === "journey" && result.saved_journey_id) {
      state.current = await api(`/api/journeys/${result.saved_journey_id}`);
      state.journeys = (await api("/api/journeys")).journeys;
      state.busy = false;
      go("creating");
      return;
    }
  } catch (error) {
    if (error.status !== 401) {
      toast(error.message);
      state.history.push({ role: "assistant", content: t("err.chat") });
    }
  }
  state.busy = false;
  if (state.page === "chat") {
    renderChat();
    document.getElementById("chatInput")?.focus();
  }
}

function renderCreating() {
  const labels = ["creating.s1", "creating.s2", "creating.s3", "creating.s4"].map((k) => t(k));
  const started = Date.now();
  const total = 6000;
  view(`<div class="page"><div class="creating">
    <div class="scene">${window.SCENE_HTML || ""}</div>
    <h1>${t("creating.title")}</h1><p>${t("creating.sub")}</p>
    <div class="bar-row"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="cBar" style="width:0%;background:#2A5BD7"></div></div><div class="pct" id="cPct">0%</div></div>
    <div class="c-steps" id="cSteps"></div></div>
    <div class="creating-foot" id="cFoot"><button class="btn-text" type="button" data-go="chat">${t("cancel")}</button></div></div>`, { locked: true });
  const timer = setInterval(() => {
    if (state.page !== "creating") { clearInterval(timer); return; }
    const p = Math.min(1, (Date.now() - started) / total);
    const pct = Math.round(p * 100);
    const bar = document.getElementById("cBar");
    bar.style.width = `${pct}%`;
    document.getElementById("cPct").textContent = `${pct}%`;
    const now = Math.min(3, Math.floor(p * 4));
    document.getElementById("cSteps").innerHTML = labels.map((label, i) => {
      const kind = p >= 1 || i < now ? "done" : i === now ? "now" : "todo";
      const mark = kind === "done" ? icon("check", 14, "#fff", 3) : kind === "now" ? "<i></i>" : "";
      return `<div class="c-step ${kind}"><span class="mark">${mark}</span>${esc(label)}</div>`;
    }).join("");
    if (p >= 1) {
      clearInterval(timer);
      bar.style.background = "#52771F";
      document.getElementById("cFoot").innerHTML = `<button class="btn btn-primary" type="button" data-act="see-journey">${t("creating.see")}</button>`;
    }
  }, 120);
}

function renderReady() {
  const record = state.current;
  if (!record) return go("journeys");
  const focusAll = Object.keys(FOCUS);
  if (state.createdFor !== record.id) { state.createdFor = record.id; state.focus = inferFocus(record); }
  view(`<div class="page">
    <div class="back-row"><div class="spacer"></div></div>
    <div class="ready-head"><div class="check-circle">${icon("check", 30, "#52771F", 3)}</div>
      <h1>${t("ready.title")}</h1><p>${esc(record.journey?.message || t("ready.fallback"))}</p></div>
    <div class="focus"><div class="row"><b>${t("ready.focus")}</b><span>${t("ready.tap")}</span></div>
      <div class="chips" id="focusChips">${focusAll.map((key) => {
        const f = FOCUS[key];
        const on = state.focus.includes(key);
        return `<button class="cat-chip ${on ? "" : "off"}" type="button" data-focus="${key}" aria-pressed="${on}" style="--c:${f.c};--t:${f.t}"><span class="i">${icon(f.icon, 16, f.c)}</span>${esc(t(f.label))}</button>`;
      }).join("")}</div></div>
    <form class="ready-form" id="readyForm">
      <label class="field"><span>${t("ready.name")}</span><input class="input" id="jName" maxlength="120" required value="${esc(record.title)}"></label>
      <label class="field"><span>${t("ready.date")}</span><div class="date-wrap"><input class="input" id="jDate" inputmode="numeric" maxlength="10" placeholder="${t("ready.datePh")}" autocomplete="off">${icon("calendar", 20, "#5F6685")}</div><div class="hint" id="jDateHint">${t("ready.dateHint")}</div></label>
    </form>
    <div class="ready-foot"><button class="btn btn-primary" type="submit" form="readyForm">${t("ready.go")}</button></div></div>`);
  document.getElementById("readyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = document.getElementById("jDate").value.trim();
    let target = null;
    if (raw) {
      const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      const d = m && new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      if (!m || d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) {
        document.getElementById("jDateHint").textContent = t("ready.dateErr");
        return;
      }
      target = d.toISOString().slice(0, 10);
    }
    const button = document.querySelector(".ready-foot button");
    button.disabled = true;
    try {
      await api(`/api/journeys/${record.id}`, { method: "PATCH", body: { title: document.getElementById("jName").value.trim() || record.title, target_date: target, focus: state.focus } });
      state.journeys = (await api("/api/journeys")).journeys;
      state.current = state.journeys.find((j) => j.id === record.id) || record;
      go("journey");
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });
}

function journeyHeader(record) {
  const blocks = blocksOf(record);
  const done = completedOf(record).size;
  const pct = percent(record);
  const target = record.journey?.target_date;
  return `<div class="jhead"><div class="top"><span class="ico">${icon("flag", 26, "#2A5BD7")}</span>
    <div style="min-width:0"><h1>${esc(record.title)}</h1>${target ? `<div class="target">${icon("calendar", 14, "#5F6685")}${esc(t("journey.target", { date: formatFull(target) }))}</div>` : ""}</div></div>
    <div><div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
    <div class="prog-row"><b>${t("journey.stepsDone", { done, total: blocks.length })}</b><span style="color:var(--muted)">${pct}%</span></div></div></div>`;
}

async function renderJourney() {
  const id = state.current?.id;
  if (!id) return go("journeys");
  view(`<div class="loading">${t("journey.loading")}</div>`);
  try {
    const record = await api(`/api/journeys/${id}`);
    if (state.page !== "journey") return;
    state.current = record;
    const blocks = blocksOf(record);
    const warning = record.journey?.needs_official_help
      ? `<div class="trust" style="margin:16px 20px 0;background:var(--orange-t);color:var(--orange-x)">${icon("info", 20, "#9A440D")}<span>${t("journey.warning")}</span></div>` : "";
    view(`<div class="page">${backRow("journeys", t("journey.my"))}${journeyHeader(record)}${warning}
      <div class="steps">${blocks.map((block, i) => {
        const status = stepStatus(record, i);
        const needs = status === "todo" && i > 0 && !completedOf(record).has(i - 1) && stepStatus(record, i - 1) !== "done"
          ? t("journey.needs", { step: i }) : (block.deadline || "");
        return `<button class="step ${status === "progress" ? "current" : ""} ${status === "done" ? "is-done" : ""}" type="button" data-step="${i}">
          <span class="ico">${icon(status === "done" ? "check" : "doc", 22, status === "done" ? "#52771F" : "#2A5BD7", status === "done" ? 3 : 1.8)}</span>
          <span class="m"><span class="n">${esc(block.title)}</span><span class="s">${pill(status)}${needs ? `<small>${esc(needs)}</small>` : ""}</span></span>${icon("chev", 18, "#5F6685")}</button>`;
      }).join("")}</div>
      <div class="j-actions"><button class="btn btn-outline" type="button" data-act="remind">${icon("bell", 18)}${t("journey.remind")}</button>
      <button class="btn btn-danger" type="button" data-act="delete-journey">${icon("trash", 18, "#B3322C")}${t("journey.delete")}</button></div></div>`);
  } catch (error) {
    if (state.page === "journey") view(`<div class="page">${backRow("journeys")}<div class="empty"><p>${esc(error.message)}</p></div></div>`);
  }
}

function renderStep() {
  const record = state.current;
  const block = blocksOf(record)[state.stepIndex];
  if (!block) return go("journey");
  const total = blocksOf(record).length;
  const status = stepStatus(record, state.stepIndex);
  const sources = new Map((record.journey?.sources || []).map((s) => [s.id, s]));
  const links = (block.source_ids || []).map((id) => sources.get(id)).filter(Boolean);
  const docs = block.documents || [];
  const maps = block.where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.where)}` : "";
  view(`<div class="page">${backRow("journey", t("step.of", { step: state.stepIndex + 1, total }))}
    <div class="sd"><span class="ico">${icon("doc", 28, "#2A5BD7")}</span><h1>${esc(block.title)}</h1>
      <div class="meta">${pill(status)}${block.deadline ? `<span class="due">${icon("clock", 14, "#5F6685")}${esc(block.deadline)}</span>` : ""}</div>
      <p class="desc">${esc(block.action)}</p></div>
    ${block.fee || block.where ? `<div class="facts">${block.fee ? `<div class="fact">${icon("wallet", 20, "#52771F")}<span>${t("step.cost")}</span><b>${esc(block.fee)}</b></div>` : ""}${block.where ? `<div class="fact">${icon("pin", 20, "#EE7F3A")}<span>${t("step.where")}</span><b>${esc(block.where)}</b></div>` : ""}</div>` : ""}
    ${docs.length ? `<div class="checklist"><h3>${t("step.bring")} <small>· ${t("step.tick")}</small></h3>${docs.map((d, i) => `<label><input type="checkbox" id="doc${i}"><span>${esc(d)}</span></label>`).join("")}</div>` : ""}
    ${block.where ? `<div class="place"><div class="t"><span class="ico">${icon("pin", 22, "#2A5BD7")}</span><div><b>${esc(block.where)}</b></div></div>
      <div class="acts"><a class="tint" href="${maps}" target="_blank" rel="noopener noreferrer">${icon("map", 18, "#2A5BD7")}${t("step.directions")}</a></div></div>` : ""}
    ${links.length ? `<div class="source-line">${icon("shield", 14, "#52771F")}${t("step.source")}: ${links.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join(" · ")}</div>` : ""}
    <div style="height:24px"></div>
    <div class="bottom-bar">${status === "done"
      ? `<button class="btn btn-outline" type="button" data-act="toggle-step">${t("step.markUndone")}</button>`
      : `<button class="btn btn-green" type="button" data-act="toggle-step">${icon("check", 20, "#fff", 3)}${t("step.markDone")}</button>`}</div></div>`);
}

async function toggleStep() {
  const record = state.current;
  const done = completedOf(record);
  if (done.has(state.stepIndex)) done.delete(state.stepIndex); else done.add(state.stepIndex);
  const list = [...done].sort((a, b) => a - b);
  const button = document.querySelector(".bottom-bar button");
  if (button) button.disabled = true;
  try {
    await api(`/api/journeys/${record.id}/progress`, { method: "PATCH", body: { completed_steps: list } });
    record.completed_steps = list;
    state.journeys = state.journeys.map((j) => (j.id === record.id ? { ...j, completed_steps: list } : j));
    if (list.length === blocksOf(record).length && list.length) return go("complete");
    toast(done.has(state.stepIndex) ? t("step.doneToast") : t("step.reopened"));
    go("journey");
  } catch (error) {
    toast(error.message);
    if (button) button.disabled = false;
  }
}

function renderJourneys() {
  const active = state.journeys.filter((j) => percent(j) < 100);
  const finished = state.journeys.filter((j) => percent(j) >= 100);
  const list = state.tab === "active" ? active : finished;
  let upnext = "";
  const dated = active.map((j) => ({ j, d: daysUntil(j.journey?.target_date) })).filter((x) => x.d !== null).sort((a, b) => a.d - b.d)[0];
  const next = dated?.j || active[0];
  if (next) {
    const blocks = blocksOf(next);
    const step = blocks.find((_, i) => !completedOf(next).has(i));
    const due = dated ? (dated.d < 0 ? t("journeys.overdue") : dated.d === 0 ? t("journeys.dueToday") : t("journeys.dueIn", { n: dated.d })) : "";
    upnext = `<button class="upnext" type="button" data-journey="${next.id}"><div class="e">${icon("clock", 14, "#C9D6FB")}${t("journeys.upNext")}${due ? ` · ${due}` : ""}</div>
      <div class="t">${esc(step?.title || next.title)}</div><div class="d">${esc(next.title)}</div><div class="o">${t("journeys.continue")} ${icon("arrow", 18, "#fff")}</div></button>`;
  }
  view(`<div class="page"><div class="screen-title"><h1>${t("journeys.title")}</h1><button class="icon-btn" type="button" data-go="home" aria-label="${t("journeys.new")}">${icon("plus")}</button></div>
    ${upnext}
    <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="active" aria-selected="${state.tab === "active"}">${t("journeys.active", { count: active.length })}</button><button type="button" role="tab" data-tab="done" aria-selected="${state.tab === "done"}">${t("journeys.completed", { count: finished.length })}</button></div>
    <div class="jlist">${list.length ? list.map((j) => {
      const pct = percent(j);
      const blocks = blocksOf(j);
      const done = completedOf(j).size;
      const target = j.journey?.target_date;
      const status = pct >= 100 ? "done" : done ? "progress" : "todo";
      return `<button class="jcard" type="button" data-journey="${j.id}"><span class="ringp" style="background:conic-gradient(${pct >= 100 ? "#52771F" : "#2A5BD7"} ${pct}%,#ECE7DE 0)"><div>${pct}%</div></span>
        <span class="m"><span class="n">${esc(j.title)}</span><span class="s">${pill(status)}<small>${t("journeys.xOfY", { done, total: blocks.length })}${target ? ` · ${esc(t("journeys.by", { date: formatDay(target) }))}` : ""}</small></span></span>${icon("chev", 18, "#5F6685")}</button>`;
    }).join("") : `<div class="empty" style="margin:10px 0 0"><p>${state.tab === "active" ? t("journeys.emptyActive") : t("journeys.emptyDone")}</p>${state.tab === "active" ? `<button class="btn btn-primary" type="button" data-go="home">${t("journeys.start")}</button>` : ""}</div>`}</div></div>`);
}

function renderComplete() {
  const record = state.current;
  if (!record) return go("journeys");
  const nextJourney = state.journeys.find((j) => j.id !== record.id && percent(j) < 100);
  const colors = ["#2A5BD7", "#EE7F3A", "#52771F", "#EC625C", "#6EA1F8", "#6227A5"];
  const confetti = Array.from({ length: 28 }, (_, i) => {
    const left = Math.round((i * 37 + 11) % 100);
    const size = 6 + (i % 4) * 2;
    return `<span class="cf" style="left:${left}%;width:${size}px;height:${size * 1.6}px;background:${colors[i % colors.length]};border-radius:2px;animation-delay:${((i * 0.23) % 4).toFixed(2)}s;animation-duration:${(4 + (i % 5) * 0.6).toFixed(1)}s"></span>`;
  }).join("");
  view(`<div class="page"><div class="confetti" aria-hidden="true">${confetti}</div>
    <div class="done-top"><div class="burst"><span class="r ring"></span><div class="o pop"><div class="i">${icon("flag", 44, "#fff", 2.2)}</div></div>
      <span class="b pop">${icon("check", 22, "#fff", 3)}</span></div>
      <div class="cg">Gratulacje!${state.language === "pl" ? "" : ` · ${t("complete.congrats")}`}</div><h1>${esc(t("complete.title", { title: record.title }))}</h1>
      <p>${t("complete.body")}</p>
      <div class="chips">${blocksOf(record).slice(0, 6).map((b) => `<span class="done-pill"><i>${icon("check", 12, "#fff", 3)}</i>${esc(b.title.length > 24 ? `${b.title.slice(0, 23)}…` : b.title)}</span>`).join("")}</div></div>
    <div class="next-card"><div class="eyebrow">${t("complete.suggested")}</div>
      <div class="r"><span class="ico">${icon(nextJourney ? "flag" : "sparkle", 22, "#52771F")}</span><div><div class="t">${esc(nextJourney ? nextJourney.title : t("complete.planNext"))}</div><div class="d">${nextJourney ? t("complete.pickUp") : t("complete.tellNext")}</div></div></div>
      <button type="button" ${nextJourney ? `data-journey="${nextJourney.id}"` : 'data-act="new-chat"'}>${nextJourney ? t("complete.open") : t("complete.startNew")}${icon("arrow", 18, "#3F5E16")}</button></div>
    <div class="done-foot"><button class="btn btn-primary" type="button" data-go="journeys">${t("complete.back")}</button></div></div>`);
}

const EXPLORE = [
  ["start", "#2A5BD7", "#E6EEFD", [["first", "flag"], ["documents", "doc"], ["rights", "scales"]]],
  ["work", "#C25A14", "#FDEDE2", [["work", "briefcase"], ["business", "shop"], ["finance", "wallet"]]],
  ["home", "#52771F", "#EAF1DF", [["housing", "home"], ["family", "family"], ["education", "cap"]]],
  ["learn", "#6227A5", "#EFE7F8", [["language", "language"], ["community", "heart"]]],
  ["health", "#C73E38", "#FDE8E7", [["health", "heart"], ["insurance", "shield"]]],
];

function renderExplore() {
  view(`<div class="page"><div class="screen-title"><h1>${t("explore.title")}</h1></div>
    <div class="search">${icon("search", 20, "#5F6685")}<input id="exSearch" type="search" placeholder="${t("explore.search")}" aria-label="${t("explore.search")}"></div>
    <div id="exList">${exploreList("")}</div>
    <button class="ask-row" type="button" data-act="new-chat"><span class="a">${icon("sparkle", 18, "#fff")}</span><span class="t">${t("explore.ask")}</span>${icon("chev", 18, "#5F6685")}</button></div>`);
  document.getElementById("exSearch").addEventListener("input", (e) => {
    document.getElementById("exList").innerHTML = exploreList(e.target.value);
  });
}
function exploreList(query) {
  const q = query.trim().toLowerCase();
  const out = EXPLORE.map(([sec, c, tint, tiles]) => {
    const name = t(`sec.${sec}`);
    const shown = tiles.filter(([key]) => !q || t(`tile.${key}`).toLowerCase().includes(q) || name.toLowerCase().includes(q));
    if (!shown.length) return "";
    return `<section class="cat" style="--c:${c};--t:${tint}"><h2><i></i>${esc(name)}</h2><div class="grid">${shown.map(([key, ic]) =>
      `<button class="cat-tile" type="button" data-topic="${esc(t(`tile.${key}.q`))}"><span class="i">${icon(ic, 22, c)}</span><span class="l">${esc(t(`tile.${key}`))}</span></button>`).join("")}</div></section>`;
  }).join("");
  return out || `<div class="empty"><p>${t("explore.noMatch")}</p></div>`;
}

function renderAlerts() {
  const now = new Date();
  const startToday = new Date(now).setHours(0, 0, 0, 0);
  const groups = { today: [], week: [], earlier: [] };
  for (const alert of state.alerts) {
    const when = new Date(alert.due_at || alert.created_at).getTime();
    (when >= startToday ? groups.today : when >= startToday - 6 * 86400000 ? groups.week : groups.earlier).push(alert);
  }
  const row = (a) => `<div class="alert ${a.is_read ? "" : "unread"}" style="align-items:flex-start">
    <span class="ico" style="background:${a.journey_id ? "#E6EEFD" : "#FDEDE2"}">${icon(a.journey_id ? "flag" : "clock", 20, a.journey_id ? "#2A5BD7" : "#C25A14")}</span>
    <button class="m" type="button" data-read="${a.id}" style="text-align:left;border:0;background:none;padding:0"><div class="h"><b>${esc(a.title)}</b><span>${esc(relTime(a.due_at || a.created_at))}</span></div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ""}</button>
    <span class="u ${a.is_read ? "off" : ""}"></span><button class="x" type="button" data-del-alert="${a.id}" aria-label="${t("alerts.delete")}">×</button></div>`;
  const sections = Object.entries(groups).filter(([, items]) => items.length).map(([name, items]) =>
    `<div class="eyebrow">${t(`alerts.${name}`)}</div>${items.map(row).join("")}`).join("");
  view(`<div class="page"><div class="screen-title"><h1>${t("alerts.title")}</h1><button class="icon-btn" type="button" data-act="toggle-reminder" aria-label="${t("alerts.new")}" aria-expanded="${state.showReminder}">${icon("plus")}</button></div>
    ${state.showReminder ? `<form class="reminder-form" id="alertForm">
      <label class="field"><span>${t("alerts.remember")}</span><input class="input" id="aTitle" maxlength="160" required placeholder="${t("alerts.rememberPh")}"></label>
      <label class="field"><span>${t("alerts.note")}</span><textarea class="input" id="aBody" maxlength="1000"></textarea></label>
      <label class="field"><span>${t("alerts.datetime")}</span><input class="input" id="aDate" type="datetime-local"></label>
      <button class="btn btn-primary" type="submit">${t("alerts.save")}</button></form>` : ""}
    <div class="alert-groups">${sections || `<div class="empty" style="margin:10px 0 0"><p>${t("alerts.empty")}</p></div>`}</div>
    ${state.alerts.some((a) => !a.is_read) ? `<div style="padding:14px 20px 0"><button class="btn btn-outline" type="button" data-act="read-all">${t("alerts.readAll")}</button></div>` : ""}
    <div class="sw-card"><div class="sw-row"><span>${t("alerts.deadlines")}</span><button class="switch" type="button" role="switch" aria-checked="${prefs.deadlines}" aria-label="${t("alerts.deadlines")}" data-pref="deadlines"><i></i></button></div>
      <div class="sw-row"><span>${t("alerts.email")}<small>${t("alerts.notYet")}</small></span><button class="switch" type="button" role="switch" aria-checked="false" aria-label="${t("alerts.email")}" disabled><i></i></button></div></div>
    <p class="acc-note" style="padding:10px 24px 24px">${t("alerts.inApp")}</p></div>`);
  const form = document.getElementById("alertForm");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const date = document.getElementById("aDate").value;
      try {
        await api("/api/alerts", { method: "POST", body: {
          title: document.getElementById("aTitle").value,
          body: document.getElementById("aBody").value,
          due_at: date ? new Date(date).toISOString() : null,
          journey_id: state.reminderJourney || null,
        } });
        state.showReminder = false;
        state.reminderJourney = "";
        state.alerts = (await api("/api/alerts")).alerts;
        toast(t("alerts.saved"));
        renderAlerts();
        renderNav();
      } catch (error) { toast(error.message); }
    });
  }
}

function renderProfile() {
  const acc = (key, ic, title, sub, body) => `<div class="acc"><div><button class="acc-btn" type="button" data-acc="${key}" aria-expanded="${state.openAcc === key}">
    <span class="ico">${icon(ic, 20, "#1B2A5C")}</span><span class="m"><b>${title}</b><span>${sub}</span></span><span class="chev">${icon("chev", 16, "#5F6685")}</span></button>
    ${state.openAcc === key ? `<div class="acc-body">${body}</div>` : ""}</div></div>`;
  const sw = (key, label, small = "") => `<div class="row"><div class="l">${label}${small ? `<small>${small}</small>` : ""}</div><button class="switch" type="button" role="switch" aria-checked="${prefs[key]}" aria-label="${label}" data-pref="${key}"><i></i></button></div>`;
  const size = (key, label) => `<button type="button" data-size="${key}" aria-pressed="${prefs.textSize === key}" style="font-size:${key === "small" ? 13 : key === "large" ? 19 : 16}px">${label}</button>`;
  view(`<div class="page"><div class="screen-title"><h1>${t("profile.title")}</h1></div>
    <div class="pcard"><span class="av">G</span><div><div class="n">${t("profile.guest")}</div><div class="e">${t("profile.private")}</div><span class="pill done">${icon("lock", 12, "currentColor", 2.4)}${t("profile.device")}</span></div></div>
    ${acc("prefs", "eye", t("profile.prefs"), t("profile.prefsSub"),
      `<div class="row"><span class="ico">${icon("globe", 18, "#1B2A5C")}</span><div class="l">${t("profile.appLang")}</div><select id="langSel" aria-label="${t("profile.appLang")}">${LANGS.map((l) => `<option value="${l.code}">${esc(l.name)}</option>`).join("")}</select></div>
      ${sw("deadlines", t("alerts.deadlines"))}
      <div style="padding:12px 0 0"><div class="eyebrow" style="margin-bottom:8px">${t("profile.textSize")}</div><div class="seg">${size("small", t("profile.small"))}${size("default", t("profile.default"))}${size("large", t("profile.large"))}</div></div>
      ${sw("contrast", t("profile.contrast"))}${sw("motion", t("profile.motion"), t("profile.motionSub"))}`)}
    ${acc("about", "user", t("profile.about"), t("profile.aboutSub"),
      `<p class="acc-note">${t("profile.aboutBody")}</p>`)}
    ${acc("docs", "doc", t("profile.journeys"), t("profile.saved", { count: state.journeys.length }),
      `<button class="row" type="button" data-go="journeys" style="width:100%;background:none;border:0;text-align:left"><span class="ico">${icon("flag", 18, "#1B2A5C")}</span><div class="l">${t("profile.open")}</div>${icon("chev", 16, "#5F6685")}</button>
      <p class="acc-note">${t("profile.noDocs")}</p>`)}
    ${acc("privacy", "shield", t("profile.privacy"), t("profile.privacySub"),
      `<p class="acc-note">${t("profile.privacyBody")}</p>`)}
    ${acc("help", "help", t("profile.help"), t("profile.helpSub"),
      `<p class="acc-note">${t("profile.helpBody")}</p>`)}
    <div class="logout"><button class="btn" type="button" data-act="logout">${icon("logout", 20, "#B3322C")}${t("profile.logout")}</button><span>${t("brand")}</span></div></div>`);
  const select = document.getElementById("langSel");
  if (select) {
    select.value = state.language;
    select.addEventListener("change", (event) => { setLanguage(event.target.value); toast(t("lang.updated")); });
  }
}

/* ---------- routing ---------- */
function render() {
  switch (state.page) {
    case "login": return renderLogin();
    case "home": return renderHome();
    case "chat": return renderChat();
    case "creating": return renderCreating();
    case "ready": return renderReady();
    case "journeys": return renderJourneys();
    case "journey": return renderJourney();
    case "step": return renderStep();
    case "complete": return renderComplete();
    case "explore": return renderExplore();
    case "alerts": return renderAlerts();
    case "profile": return renderProfile();
    default: state.page = "home"; return renderHome();
  }
}

async function loadAll() {
  const [conversation, journeys, alerts] = await Promise.all([
    api("/api/conversation"), api("/api/journeys"), api("/api/alerts"),
  ]);
  state.history = Array.isArray(conversation.history) ? conversation.history : [];
  state.journeys = journeys.journeys || [];
  state.alerts = alerts.alerts || [];
}

async function refreshJourneys() {
  try { state.journeys = (await api("/api/journeys")).journeys; } catch { /* handled by api() */ }
}

document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-go],[data-act],[data-topic],[data-journey],[data-step],[data-tab],[data-focus],[data-acc],[data-pref],[data-size],[data-read],[data-del-alert],[data-info],[data-lang]");
  if (state.langOpen && !(el && (el.dataset.lang || el.dataset.act === "lang"))) { state.langOpen = false; if (state.page === "login") renderLogin(); }
  if (!el) return;
  const d = el.dataset;
  if (d.lang) { state.langOpen = false; return setLanguage(d.lang); }
  if (d.info) return toast(t(LOGIN_INFO[d.info]));
  if (d.topic) {
    state.history = [];
    state.sources = [];
    state.page = "chat";
    renderChat();
    sendChat(d.topic);
    return;
  }
  if (d.journey) {
    state.current = state.journeys.find((j) => j.id === d.journey) || { id: d.journey };
    return go("journey");
  }
  if (d.step !== undefined) return go("step", { stepIndex: Number(d.step) });
  if (d.tab) { state.tab = d.tab; return renderJourneys(); }
  if (d.focus) {
    state.focus = state.focus.includes(d.focus) ? state.focus.filter((k) => k !== d.focus) : [...state.focus, d.focus];
    el.classList.toggle("off", !state.focus.includes(d.focus));
    el.setAttribute("aria-pressed", String(state.focus.includes(d.focus)));
    return;
  }
  if (d.acc) { state.openAcc = state.openAcc === d.acc ? "" : d.acc; return renderProfile(); }
  if (d.pref) { prefs[d.pref] = !prefs[d.pref]; applyPrefs(); return render(); }
  if (d.size) { prefs.textSize = d.size; applyPrefs(); return render(); }
  if (d.read) {
    const alert = state.alerts.find((a) => a.id === d.read);
    if (alert) {
      alert.is_read = !alert.is_read;
      renderAlerts();
      try { await api(`/api/alerts/${alert.id}`, { method: "PATCH", body: { is_read: alert.is_read } }); }
      catch (error) { alert.is_read = !alert.is_read; renderAlerts(); toast(error.message); }
    }
    return;
  }
  if (d.delAlert) {
    try {
      await api(`/api/alerts/${d.delAlert}`, { method: "DELETE" });
      state.alerts = state.alerts.filter((a) => a.id !== d.delAlert);
      renderAlerts();
    } catch (error) { toast(error.message); }
    return;
  }
  if (d.go) {
    if (d.go === "journeys") await refreshJourneys();
    if (d.go === "alerts") {
      try { state.alerts = (await api("/api/alerts")).alerts; } catch { /* handled by api() */ }
    }
    if (d.go === "chat" && !state.authenticated) return;
    return go(d.go);
  }
  switch (d.act) {
    case "lang": state.langOpen = !state.langOpen; return renderLogin();
    case "new-chat": return startNewChat();
    case "login-phone": state.loginStep = "phone"; return renderLogin();
    case "login-back": state.loginStep = "start"; state.loginError = ""; return renderLogin();
    case "mic": return toast(t("chat.micSoon"));
    case "create": return sendChat(t("chat.createPrompt"));
    case "see-journey": return go("ready");
    case "toggle-step": return toggleStep();
    case "toggle-reminder": state.showReminder = !state.showReminder; return renderAlerts();
    case "remind": state.reminderJourney = state.current?.id || ""; state.showReminder = true; return go("alerts");
    case "read-all": {
      const unread = state.alerts.filter((a) => !a.is_read);
      unread.forEach((a) => { a.is_read = true; });
      renderAlerts();
      await Promise.allSettled(unread.map((a) => api(`/api/alerts/${a.id}`, { method: "PATCH", body: { is_read: true } })));
      return;
    }
    case "delete-journey":
      if (!window.confirm(t("journey.confirmDelete"))) return;
      try {
        await api(`/api/journeys/${state.current.id}`, { method: "DELETE" });
        state.journeys = state.journeys.filter((j) => j.id !== state.current.id);
        state.current = null;
        toast(t("journey.deleted"));
        go("journeys");
      } catch (error) { toast(error.message); }
      return;
    case "logout":
      try {
        await api("/api/session/logout", { method: "POST" });
        Object.assign(state, { authenticated: false, recoveryAvailable: true, loginStep: "start", history: [], journeys: [], alerts: [], current: null, loginError: "" });
        toast(t("profile.signedOut"));
        go("login");
      } catch (error) { toast(error.message); }
      return;
    default:
  }
});

async function initialize() {
  try {
    const session = await api("/api/session");
    state.authenticated = session.authenticated;
    state.recoveryAvailable = session.recovery_available;
    if (state.authenticated) {
      await loadAll();
      state.page = "home";
    } else if (session.recovery_available) {
      state.loginError = t("err.expired");
    }
  } catch (error) {
    state.authenticated = false;
    state.loginStep = "phone";
    state.loginError = error.message;
  }
  if (!state.authenticated) state.page = "login";
  render();
}

initialize();
