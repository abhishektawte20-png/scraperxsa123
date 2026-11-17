#!/usr/bin/env node
// Static quality checks of a PACKAGE folder (the folder that is zipped), before it is sent to anyone:
//   node scripts/release-qa.mjs <path to the unzipped ScraperX-UI-Automation-Tool folder> [--webhook]
// Checks: manifest, every file the extension loads exists, every script parses, the team mappings are valid and safe, the
// feedback channel is set (with --webhook), nothing that should not be shipped is inside.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] || ".");
const wantWebhook = process.argv.includes("--webhook");
const problems = [];
const ok = (message) => console.log(`  ok   ${message}`);
const bad = (message) => { problems.push(message); console.log(`  FAIL ${message}`); };
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

// 1. manifest
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
manifest.manifest_version === 3 ? ok("manifest v3") : bad("manifest is not v3");
manifest.version === pkg.version ? ok(`version ${manifest.version} matches package.json`) : bad(`manifest ${manifest.version} != package ${pkg.version}`);
manifest.key ? ok("stable extension key present") : bad("manifest has no key (the extension id would change)");
for (const icon of Object.values(manifest.icons || {})) exists(icon) ? null : bad(`icon missing: ${icon}`);
if (manifest.background?.service_worker) exists(manifest.background.service_worker) ? ok("service worker exists") : bad("service worker missing");
const hosts = [...(manifest.host_permissions || [])];
console.log(`  info host permissions: ${hosts.join(", ")}`);

// 2. every file the worker injects exists
const bg = read("background/background.js");
const listed = new Set();
for (const m of bg.matchAll(/"((?:core|content|background|registry)\/[\w\/.-]+\.js)"/g)) listed.add(m[1]);
const missing = [...listed].filter((f) => !exists(f));
missing.length ? bad(`files named in background.js but missing: ${missing.join(", ")}`) : ok(`all ${listed.size} files named in background.js exist`);

// 3. every script parses
let parsed = 0;
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const file of ["background", "content", "core", "registry"].filter(exists).flatMap(walk).filter((f) => f.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" }); parsed++; } catch (error) { bad(`syntax error in ${file}: ${String(error.stderr || error.message).split("\n")[0]}`); }
}
ok(`${parsed} scripts parse`);

// 4. team mappings valid and safe; feedback channel
globalThis.SXRTS = {};
const load = (file) => new Function(read(file)).call(globalThis);
for (const f of ["core/outputFields.js", "core/customFields.js", "core/selectorBuilder.js", "core/feedbackConfig.js", "core/feedback.js"]) {
  try { load(f); } catch (error) { bad(`could not load ${f}: ${error.message}`); }
}
try {
  load("core/teamDefaults.js");
  const defs = globalThis.SXRTS.teamDefaults?.mappings || [];
  defs.length ? ok(`${defs.length} team mappings shipped`) : bad("no team mappings shipped");
  for (const def of defs) {
    const errors = globalThis.SXRTS.customFields.validateDefinition(def);
    errors.length ? bad(`mapping ${def.key} invalid: ${errors.join("; ")}`) : null;
    for (const step of def.window?.preSave || []) {
      if ((step.selectors?.[0] && step.selectors[0] === def.saveButton?.selectors?.[0]) || (step.text && step.text.toLowerCase() === (def.saveButton?.text || "").toLowerCase())) bad(`mapping ${def.key}: a step before Save is the Save button itself`);
    }
    if (/close|cancel/i.test(JSON.stringify([def.openButton, def.window?.preSave, def.saveButton]).replace(/"text":"[^"]*"/g, ""))) bad(`mapping ${def.key} lists a close/cancel control`);
  }
} catch (error) { bad(`team defaults: ${error.message}`); }
try {
  const check = globalThis.SXRTS.feedback?.check?.();
  if (wantWebhook) check?.ok ? ok(`feedback channel set (${check.kind})`) : bad("the feedback channel (Teams address) is NOT set in this package");
  else console.log(`  info feedback channel: ${check?.ok ? "set" : "not set"}`);
} catch (error) { bad(`feedback check: ${error.message}`); }

// 5. what must not be inside
const all = ["", ...walk(".")].filter(Boolean);
for (const f of all) {
  if (/(^|\/)(node_modules|\.git|tests)(\/|$)/.test(f)) bad(`should not be shipped: ${f}`);
}
const secretFiles = all.filter((f) => /\.(js|json|md|html|txt)$/.test(f) && /sig=[A-Za-z0-9_-]{20,}/.test(read(f)));
secretFiles.filter((f) => f !== "core/feedbackConfig.js").length ? bad(`a webhook signature appears outside feedbackConfig.js: ${secretFiles.join(", ")}`) : ok("the channel secret appears only in core/feedbackConfig.js");

console.log(problems.length ? `\n${problems.length} problem(s)` : "\nAll static checks passed.");
process.exit(problems.length ? 1 : 0);
