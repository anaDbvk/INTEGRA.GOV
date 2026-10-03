const fs = require("fs");
const vm = require("vm");
const path = require("path");

function el(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", disabled: false, dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0, className: "",
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, fn) { this["on" + type] = fn; }, focus() {}, insertAdjacentHTML(_, h) { this.innerHTML += h; }, setAttribute() {},
    querySelector() { return el("q"); },
  };
}
const els = new Proxy({}, { get(o, k) { if (typeof k === "string" && !(k in o)) o[k] = el(k); return o[k]; } });
let clickHandler;
const document = {
  documentElement: el("root"),
  getElementById(id) { return els[id] || (els[id] = el(id)); },
  querySelector() { return el("q"); },
  addEventListener(type, fn) { if (type === "click") clickHandler = fn; },
};
// fake history stack
const stack = [];
let pos = -1;
let popHandler;
const history = {
  get state() { return pos >= 0 ? stack[pos] : null; },
  pushState(s) { stack.splice(pos + 1); stack.push(JSON.parse(JSON.stringify(s))); pos++; },
  replaceState(s) { if (pos < 0) { stack.push(null); pos = 0; } stack[pos] = JSON.parse(JSON.stringify(s)); },
  back() { if (pos > 0) { pos--; popHandler({ state: stack[pos] }); } },
};
const J1 = {
  id: "j1", title: "PESEL", completed_steps: [0],
  journey: { journey_blocks: [{ title: "Apply for PESEL", action: "Go", source_ids: ["S1"] }, { title: "Buy SIM", action: "", custom: true, source_ids: [] }], sources: [{ id: "S1", title: "gov", url: "https://www.gov.pl" }] },
};
const requests = [];
const responses = {
  "GET /api/session": { authenticated: true, recovery_available: false },
  "GET /api/conversation": { history: [] },
  "GET /api/journeys": { journeys: [J1] },
  "GET /api/alerts": { alerts: [] },
  "GET /api/journeys/j1": J1,
  "POST /api/journeys": { ...J1, id: "j2", title: "Own" },
  "GET /api/journeys/j2": { ...J1, id: "j2", title: "Own" },
  "PUT /api/journeys/j1/steps": { journey_blocks: J1.journey.journey_blocks, completed_steps: [0] },
};
const store = {};
const ctx = {
  document, console, setTimeout, clearTimeout, setInterval, clearInterval, Headers: class { set() {} }, Date, Intl, Promise, history,
  navigator: { languages: ["en-US"], language: "en-US" },
  localStorage: { getItem(k) { return store[k] ?? null; }, setItem(k, v) { store[k] = String(v); } },
  addEventListener(type, fn) { if (type === "popstate") popHandler = fn; },
  confirm: () => true,
  fetch: async (p, o = {}) => {
    const key = `${o.method || "GET"} ${p}`;
    requests.push({ key, body: o.body ? JSON.parse(o.body) : null });
    return { ok: true, status: 200, json: async () => responses[key] || {} };
  },
};
ctx.window = ctx;
vm.createContext(ctx);
const appPath = process.argv[2];
vm.runInContext(fs.readFileSync(path.join(path.dirname(appPath), "i18n.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(appPath, "utf8"), ctx);

const page = () => vm.runInContext("state.page", ctx);
const click = async (dataset) => { await clickHandler({ target: { closest: () => ({ dataset, classList: { toggle() {} }, setAttribute() {} }) } }); await new Promise((r) => setTimeout(r, 20)); syncDom(); };
function syncDom() { const b = vm.runInContext("state.page === \"builder\" ? state.builder : null", ctx); if (!b) return; b.steps.forEach((s, i) => { if (s.official) return; els[`b-title-${i}`].value = s.title; els[`b-action-${i}`].value = s.action; els[`b-deadline-${i}`].value = s.deadline; }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(100);
  const checks = {};
  checks.startsHome = page() === "home";
  checks.homeHasNav = els.nav.innerHTML.includes('data-go="journeys"');
  checks.homeOwnCard = els.screen.innerHTML.includes('data-act="new-own"') && els.screen.innerHTML.includes("Create my own journey");

  await click({ go: "journeys" });
  await click({ journey: "j1" });
  await sleep(30);
  checks.journeyEditButton = els.screen.innerHTML.includes('data-act="edit-steps"');
  await click({ step: "1" });
  checks.ownStepLabel = els.screen.innerHTML.includes("Your own step");
  history.back();
  await sleep(30);
  checks.backFromStepToJourney = page() === "journey";
  history.back();
  await sleep(30);
  checks.backFromJourneyToJourneys = page() === "journeys";

  // switching between tabs does not grow the stack
  await click({ go: "explore" });
  await click({ go: "alerts" });
  history.back();
  await sleep(30);
  checks.tabBackGoesHome = page() === "home";

  // + menu on journeys
  await click({ go: "journeys" });
  await click({ act: "new-menu" });
  checks.newMenuChoices = els.screen.innerHTML.includes("Plan with the assistant") && els.screen.innerHTML.includes("Create my own");

  // create own journey
  await click({ act: "new-own" });
  checks.builderOpen = page() === "builder" && els.screen.innerHTML.includes('id="bName"');
  els.bName.value = "Own";
  els.bDate.value = "01.12.2026";
  els["b-title-0"].value = "Find a flat";
  els["b-action-0"].value = "OLX";
  await click({ act: "builder-add" });
  checks.secondStepAdded = els.screen.innerHTML.includes('id="b-title-1"') && els["b-title-0"].value === "Find a flat";
  els["b-title-1"].value = "Register address";
  await click({ bmove: "1:-1" });
  checks.reordered = vm.runInContext("state.builder.steps[0].title", ctx) === "Register address";
  // empty step without name is dropped; name check
  await click({ act: "builder-add" });
  await els.builderForm.onsubmit({ preventDefault() {} });
  await sleep(30);
  console.log(JSON.stringify(requests.filter((r) => r.key.startsWith("POST"))));
  const post = requests.find((r) => r.key === "POST /api/journeys");
  checks.postedOwn = !!post && post.body.title === "Own" && post.body.target_date === "2026-12-01" && post.body.steps.length === 2 && post.body.steps[0].title === "Register address";
  checks.afterSaveJourney = page() === "journey" && vm.runInContext("state.current.id", ctx) === "j2";
  history.back();
  await sleep(30);
  checks.backAfterSaveSkipsBuilder = page() === "journeys";

  // validation: step with note but no name
  await click({ act: "new-own" });
  els.bName.value = "X";
  els["b-title-0"].value = "";
  els["b-action-0"].value = "note only";
  const before = requests.length;
  await els.builderForm.onsubmit({ preventDefault() {} });
  checks.needsStepName = els.builderError.textContent === "Give every step a name." && requests.length === before;

  // edit steps keeps official step reference
  await click({ back: "journeys" });
  await click({ journey: "j1" });
  await sleep(30);
  await click({ act: "edit-steps" });
  checks.officialBadge = els.screen.innerHTML.includes("Official step from the assistant");
  const fill = (i, title) => { els[`b-title-${i}`].value = title; els[`b-action-${i}`].value = ""; els[`b-deadline-${i}`].value = ""; };
  fill(1, "Buy SIM");
  await click({ bdel: "0" });
  fill(0, "Buy SIM");
  await els.builderForm.onsubmit({ preventDefault() {} });
  await sleep(30);
  const put = requests.find((r) => r.key === "PUT /api/journeys/j1/steps");
  checks.editPut = !!put && put.body.steps.length === 1 && put.body.steps[0].from_index === 1 && put.body.steps[0].title === "Buy SIM";

  for (const lang of ["pl", "uk"]) {
    vm.runInContext(`state.language = "${lang}"; openBuilder(null);`, ctx);
    checks[`${lang}-builderNoRawKeys`] = !/\b(builder|ready|home|journeys)\.[a-z]/.test(els.screen.innerHTML.replace(/data-[a-z-]+="[^"]*"/g, ""));
  }
  console.log(JSON.stringify(checks, null, 1));
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
