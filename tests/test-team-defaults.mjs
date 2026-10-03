// Team defaults: mappings and output rules that ship inside the extension,
// with each researcher's own changes layered on top; export / import of the
// shipped file; and how the lists show it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/customFields.js";
import "../core/outputRules.js";
import "../core/outputFields.js";
import "../core/selectorBuilder.js";
import "../core/teamShare.js";
import "../content/teach.js";

const store = new Map();
global.chrome = {
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
  storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } }
};

const cf = () => globalThis.SXRTS.customFields;
const rules = () => globalThis.SXRTS.outputRules;
const ts = () => globalThis.SXRTS.teamShare;

const smDef = {
  key: "businessEntitySocialMediaIdentifiers", label: "Social media identifiers", description: "", kind: "record",
  fields: [{ key: "handle", kind: "text", selectors: ["#identifierText"] }],
  openButton: { selectors: ["#change"], text: "New" },
  saveButton: { selectors: ["#save"], text: "Save Changes" },
  window: { path: "/x", preSave: [] },
  rowBy: { outKey: "network", rowSelector: "div.smRow" },
  binds: { path: "businessEntity.socialMediaIdentifiers", map: { handle: "handleOrUrl" } }
};
const descDef = (selector) => ({
  key: "companyBriefDescription", label: "Brief description", description: "", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: [selector] }],
  saveButton: { selectors: ["#saveDesc"], text: "Save" },
  binds: { path: "company.briefDescription", map: { value: "value" } }
});
const teamRule = { id: "team-fb", label: "Facebook handle only", target: "smi.any", steps: [{ type: "lastPathSegment" }], enabled: true };

async function boot(teamDefaults, localDefs = [], localRules = []) {
  store.clear();
  if (localDefs.length) store.set("sxrts_custom_fields", localDefs);
  if (localRules.length) store.set("sxrts_output_rules", localRules);
  globalThis.SXRTS.teamDefaults = teamDefaults;
  await cf().load();
  await rules().load();
}
const shipped = (mappings, ruleList = []) => ({ format: "scraperx-team-defaults", version: 1, exportedAt: "2026-10-03T00:00:00.000Z", extensionVersion: "1.0.0", mappings, rules: ruleList });

test("team mappings and rules are in effect from the start, marked as the team's", async () => {
  await boot(shipped([smDef, descDef("#brief")], [teamRule]));
  assert.deepEqual(cf().getCached().map((d) => [d.key, d.fromTeam]), [["businessEntitySocialMediaIdentifiers", true], ["companyBriefDescription", true]]);
  assert.equal(cf().getBoundDef("company.briefDescription").fields[0].selectors[0], "#brief");
  assert.equal(rules().getCached()[0].fromTeam, true);
  assert.equal(store.has("sxrts_custom_fields"), false, "nothing is copied into this browser's storage");
});

test("an invalid shipped mapping or rule is dropped instead of breaking the extension", async () => {
  await boot(shipped([smDef, { ...descDef("#x"), fields: [] }], [teamRule, { id: "bad", label: "x", target: "nope", steps: [] }]));
  assert.equal(cf().getCached().length, 1);
  assert.equal(rules().getCached().length, 1);
});

test("a researcher's own mapping replaces the team's for that field, and removing it brings the team's back", async () => {
  await boot(shipped([descDef("#brief")]));
  await cf().saveDefinition(descDef("#myBrief"));
  const effective = cf().getBoundDef("company.briefDescription");
  assert.equal(effective.fields[0].selectors[0], "#myBrief");
  assert.equal(effective.fromTeam, undefined);
  assert.equal(cf().overridesTeam(effective), true);
  assert.equal(cf().getCached().length, 1, "never both");
  assert.equal(store.get("sxrts_custom_fields").length, 1);
  assert.equal(cf().getTeam()[0].fields[0].selectors[0], "#brief", "the team default itself is untouched");

  await cf().removeDefinition("companyBriefDescription");
  assert.equal(cf().getBoundDef("company.briefDescription").fields[0].selectors[0], "#brief");
  assert.equal(cf().getBoundDef("company.briefDescription").fromTeam, true);
});

test("a team mapping cannot be deleted from a browser, and Reset drops only the changes that replace team ones", async () => {
  await boot(shipped([descDef("#brief")]));
  await cf().removeDefinition("companyBriefDescription");
  assert.equal(cf().getCached().length, 1, "removing a team-only mapping does nothing");

  await cf().saveDefinition(descDef("#myBrief"));
  await cf().saveDefinition({ key: "foundedYear", label: "Founded year", description: "", kind: "single", fields: [{ key: "value", kind: "text", selectors: ["#fy"] }], saveButton: { selectors: ["#s"], text: "Save" } });
  assert.equal(cf().getCached().length, 2);
  assert.equal(await cf().resetToTeam(), 1);
  assert.deepEqual(cf().getCached().map((d) => d.key).sort(), ["companyBriefDescription", "foundedYear"]);
  assert.equal(cf().getBoundDef("company.briefDescription").fromTeam, true);
});

test("output rules layer the same way, by id", async () => {
  await boot(shipped([], [teamRule]));
  await rules().saveRule({ ...teamRule, label: "My version", steps: [{ type: "lowercase" }] });
  assert.equal(rules().getCached().length, 1);
  assert.equal(rules().getCached()[0].label, "My version");
  assert.equal(rules().overridesTeam(rules().getCached()[0]), true);
  await rules().removeRule("team-fb");
  assert.equal(rules().getCached()[0].fromTeam, true);
  await rules().saveRule({ label: "Own rule", target: "smi.any", steps: [{ type: "trim" }] });
  await rules().saveRule({ ...teamRule, label: "Changed" });
  assert.equal(await rules().resetToTeam(), 1);
  assert.deepEqual(rules().getCached().map((r) => r.label).sort(), ["Facebook handle only", "Own rule"]);
});

test("the exported file is a working core/teamDefaults.js holding the effective set", async () => {
  await boot(shipped([smDef, descDef("#brief")], [teamRule]));
  await cf().saveDefinition(descDef("#myBrief"));
  const file = ts().buildFile();
  assert.match(file, /replace core\/teamDefaults\.js/);

  const sandbox = {};
  vm.runInNewContext(file, sandbox);
  const exported = JSON.parse(JSON.stringify(sandbox.SXRTS.teamDefaults)); // out of the vm realm
  assert.equal(exported.format, "scraperx-team-defaults");
  assert.equal(exported.extensionVersion, "9.9.9");
  assert.deepEqual(exported.mappings.map((d) => d.key).sort(), ["businessEntitySocialMediaIdentifiers", "companyBriefDescription"]);
  assert.equal(exported.mappings.find((d) => d.key === "companyBriefDescription").fields[0].selectors[0], "#myBrief", "the exporter's own change is what gets shipped");
  assert.ok(exported.mappings.every((d) => !("fromTeam" in d)));
  assert.equal(exported.rules[0].id, "team-fb");

  // Shipping it: a fresh browser with that file as its team defaults has the same set.
  await boot(exported);
  assert.deepEqual(cf().getCached().map((d) => d.key).sort(), ["businessEntitySocialMediaIdentifiers", "companyBriefDescription"]);
});

test("import reads the .js file or plain JSON, rejects anything else, and skips invalid entries", async () => {
  await boot(shipped([]));
  assert.match(ts().parseFile("hello").error, /not a ScraperX team defaults file/);
  assert.match(ts().parseFile('{"format":"other"}').error, /not a ScraperX team defaults file/);
  assert.match(ts().parseFile("").error, /not a ScraperX team defaults file/);

  const data = shipped([smDef, { ...descDef("#x"), fields: [] }], [teamRule]);
  for (const text of [JSON.stringify(data), ts().buildFile(data)]) {
    const parsed = ts().parseFile(text);
    assert.deepEqual(parsed.data.mappings.length, 2);
  }
  const result = await ts().importData(ts().parseFile(JSON.stringify(data)).data);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /Brief description/);
  assert.equal(cf().getCached().length, 1);
  assert.equal(store.get("sxrts_custom_fields").length, 1, "imported mappings become this browser's own");
  assert.equal(rules().getCached().length, 1);
});

test("the file that ships in the repo parses, and background.js loads it before the code that reads it", () => {
  const text = readFileSync(new URL("../core/teamDefaults.js", import.meta.url), "utf8");
  assert.ok(ts().parseFile(text).data);
  const background = readFileSync(new URL("../background/background.js", import.meta.url), "utf8");
  const order = (name) => background.indexOf(`"core/${name}.js"`);
  assert.ok(order("teamDefaults") > -1 && order("teamDefaults") < order("customFields"));
  assert.ok(order("teamDefaults") < order("outputRules"));
  assert.ok(order("teamShare") > order("customFields") && order("teamShare") > order("outputRules"));
  assert.ok(order("teamShare") < order("teamShare") + 1 && background.indexOf('"content/teach.js"') > order("teamShare"));
});

function mountTeach() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, MouseEvent: window.MouseEvent });
  window.confirm = () => true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const teach = globalThis.SXRTS.teach.mount(shadow);
  teach.open();
  return { shadow, window };
}
const button = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

test("the mapped-fields window labels team defaults, offers no Delete for them, and exports the file", async () => {
  await boot(shipped([smDef, descDef("#brief")], [teamRule]));
  await cf().saveDefinition(descDef("#myBrief"));
  const { shadow, window } = mountTeach();
  const card = shadow.querySelector(".teach-card");
  assert.match(card.textContent, /This version ships 2 mapping\(s\) and 1 rule\(s\), exported/);
  assert.match(card.textContent, /Social media identifiers.*team default/);
  assert.match(card.textContent, /Brief description.*your change \(replaces the team default\)/);
  const items = Array.from(card.querySelectorAll(".teach-item"));
  const team = items.find((i) => /Social media/.test(i.textContent));
  const mine = items.find((i) => /Brief description/.test(i.textContent));
  assert.equal(button(team, "Delete"), undefined);
  assert.ok(button(team, "Re-map"));
  assert.ok(button(mine, "Reset to team default"));

  let downloaded = null;
  window.URL.createObjectURL = (blob) => { downloaded = blob; return "blob:x"; };
  window.URL.revokeObjectURL = () => {};
  global.URL = window.URL;
  global.Blob = window.Blob;
  window.HTMLAnchorElement.prototype.click = function () { downloaded = { ...downloaded, name: this.download }; };
  button(card, "Export team defaults").click();
  assert.equal(downloaded.name, "teamDefaults.js");
  assert.match(card.textContent, /Downloaded teamDefaults\.js with 2 mapping\(s\) and 1 rule\(s\)/);

  button(card, "Reset to team defaults").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(card.textContent, /Reset 1 change\(s\) to the team defaults/);
  assert.equal(cf().getBoundDef("company.briefDescription").fromTeam, true);
});
