const fs = require("fs");
const vm = require("vm");
const path = require("path");

function el(id) {
  return {
    id, innerHTML: "", textContent: "", value: "", disabled: false, dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0, className: "",
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, focus() {}, insertAdjacentHTML(_, h) { this.innerHTML += h; }, setAttribute() {},
    querySelector() { return el("q"); },
  };
}
const els = {};
const document = {
  documentElement: el("root"),
  getElementById(id) { return els[id] || (els[id] = el(id)); },
  querySelector() { return null; },
  addEventListener() {},
};
const responses = {
  "/api/session": { authenticated: false, recovery_available: false },
};
const store = {};
const ctx = {
  document, window: {}, console, setTimeout, clearTimeout, setInterval, clearInterval, Headers: class { set() {} }, Date, Intl, Promise,
  navigator: { languages: [process.argv[3] || "en-US"], language: process.argv[3] || "en-US" },
  localStorage: { getItem(k) { return store[k] ?? null; }, setItem(k, v) { store[k] = String(v); } },
  addEventListener() {}, history: { state: null, pushState() {}, replaceState() {}, back() {} },
  fetch: async (p) => ({ ok: true, status: 200, json: async () => responses[p] || {} }),
};
ctx.window = ctx;
vm.createContext(ctx);
const appPath = process.argv[2];
vm.runInContext(fs.readFileSync(path.join(path.dirname(appPath), "i18n.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(appPath, "utf8"), ctx);

setTimeout(() => {
  const checks = {};
  const lang = vm.runInContext("state.language", ctx);
  if (process.argv[3] === "pl-PL") {
    checks.detectedPolish = lang === "pl" && document.documentElement.lang === "pl";
    checks.polishLogin = els.screen.innerHTML.includes("Zaloguj się numerem telefonu");
    console.log(JSON.stringify(checks, null, 1));
    process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
  }
  const screen = els.screen.innerHTML;
  Object.assign(checks, {
    defaultEnglish: lang === "en",
    loginWitaj: screen.includes("Witaj"),
    loginPhoneButton: screen.includes("Log in with phone"),
    loginCreate: screen.includes("New here? Create an account"),
    loginGdpr: screen.includes("protected under GDPR"),
  });
  vm.runInContext('state.langOpen = true; renderLogin();', ctx);
  checks.langMenu = els.screen.innerHTML.includes('data-lang="uk"') && els.screen.innerHTML.includes("Українська");
  vm.runInContext('state.langOpen = false; setLanguage("uk");', ctx);
  checks.ukLogin = els.screen.innerHTML.includes("Увійти за номером телефону") && store.smartin_lang === "uk";
  vm.runInContext('setLanguage("en");', ctx);
  vm.runInContext('state.authenticated = true; state.history = [{role:"user",content:"old"}]; startNewChat();', ctx);
  const chat = els.screen.innerHTML;
  checks.chatHasNoBubbles = !chat.includes("bubble");
  checks.chatHasComposer = chat.includes("Ask anything about moving to Poland");
  checks.chatHeader = chat.includes("Gov Assistant");
  vm.runInContext('setLanguage("pl");', ctx);
  checks.chatPolish = els.screen.innerHTML.includes("Asystent urzędowy");
  const pages = ["home", "explore", "alerts", "profile", "journeys"];
  for (const lang2 of ["pl", "uk"]) {
    for (const page of pages) {
      vm.runInContext(`state.language = "${lang2}"; go("${page}");`, ctx);
      const html = els.screen.innerHTML + els.nav.innerHTML;
      checks[`${lang2}-${page}-noRawKeys`] = !/\b(home|nav|profile|alerts|explore|journeys|tile|sec|topic)\.[a-z]/.test(html.replace(/data-[a-z-]+="[^"]*"/g, ""));
    }
  }
  vm.runInContext('state.language = "en"; go("login"); state.loginStep="phone"; renderLogin();', ctx);
  checks.phoneStep = els.screen.innerHTML.includes('id="loginForm"');
  console.log(JSON.stringify(checks, null, 1));
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}, 200);
