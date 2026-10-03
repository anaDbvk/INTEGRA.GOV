const fs = require("fs");
const vm = require("vm");
const dir = process.argv[2];
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(dir + "/i18n.js", "utf8"), ctx);
const I = ctx.window.I18N;
const app = fs.readFileSync(dir + "/app.js", "utf8");
const keys = new Set([...app.matchAll(/\bt\("([\w.]+)"/g)].map((m) => m[1]));
for (const k of ["pesel", "residence", "health", "rent"]) { keys.add(`topic.${k}`); keys.add(`topic.${k}.q`); }
for (const s of ["start", "work", "home", "learn", "health"]) keys.add(`sec.${s}`);
for (const k of ["first","documents","rights","work","business","finance","housing","family","education","language","community","health","insurance"]) { keys.add(`tile.${k}`); keys.add(`tile.${k}.q`); }
for (const g of ["today", "week", "earlier"]) keys.add(`alerts.${g}`);
for (const k of ["privacy", "accessibility", "help"]) keys.add(`info.${k}`);
for (const k of ["first","housing","finance","health","safety"]) keys.add(`focus.${k}`);
for (const i of [1,2,3,4]) keys.add(`creating.s${i}`);
let missing = 0;
for (const lang of ["en", "pl", "uk"]) for (const k of keys) if (!(k in I[lang])) { console.log("missing", lang, k); missing++; }
const extra = Object.keys(I.en).filter((k) => !keys.has(k));
console.log("keys used:", keys.size, "missing:", missing, "unused en:", extra.join(","));
for (const lang of ["pl", "uk"]) {
  const diff = Object.keys(I.en).filter((k) => !(k in I[lang]));
  if (diff.length) console.log("not in", lang, diff.join(","));
}
process.exit(missing ? 1 : 0);
