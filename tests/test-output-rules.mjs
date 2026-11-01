// Saved output rules: the engine, its hook into validation, and the dialog.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../core/resultsSummary.js";
import "../core/outputRules.js";
import "../core/customFields.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import "../core/outputFields.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../content/rules.js";
import "../content/ui.js";
import "../content/panel.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

// These tests exercise the output-rule and mapping machinery with the agent's full links; the built-in handle-only step is covered in test-social-handle.mjs.
globalThis.SXRTS.rovoContract.settings.handlesOnly = false;

const store = new Map();
global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };
const or = globalThis.SXRTS.outputRules;
const schema = globalThis.SXRTS.schema;

// ---- engine ----

test("the Reliance example: Facebook URL -> just the handle", () => {
  const run = (v) => or.runSteps([{ type: "lastPathSegment" }], v);
  assert.equal(run("https://www.facebook.com/RelianceIndustriesLimited/"), "RelianceIndustriesLimited");
  assert.equal(run("facebook.com/RelianceIndustriesLimited/"), "RelianceIndustriesLimited");
  assert.equal(run("https://www.facebook.com/RelianceIndustriesLimited/?ref=page_internal#x"), "RelianceIndustriesLimited");
  assert.equal(run("https://www.linkedin.com/company/reliance-industries-limited/"), "reliance-industries-limited");
  assert.equal(run("https://www.facebook.com/"), "https://www.facebook.com/", "no path -> left alone");
  assert.equal(run("RelianceIndustriesLimited"), "RelianceIndustriesLimited", "already a handle -> left alone");
});

test("every step is literal and predictable", () => {
  const r = (type, extra, v) => or.runSteps([{ type, ...extra }], v);
  assert.equal(r("pathAfterDomain", {}, "https://www.linkedin.com/company/acme/"), "company/acme");
  assert.equal(r("removeProtocol", {}, "https://www.acme.com/x"), "acme.com/x");
  assert.equal(r("stripQuery", {}, "https://acme.com/a?b=1#c"), "https://acme.com/a");
  assert.equal(r("stripTrailingSlash", {}, "acme.com///"), "acme.com");
  assert.equal(r("stripAt", {}, "@@acme"), "acme");
  assert.equal(r("lowercase", {}, "AcMe"), "acme");
  assert.equal(r("replace", { find: ".(x)", with: "-" }, "a.(x)b"), "a-b", "no regex: the text is matched literally");
  assert.equal(r("replace", { find: "", with: "-" }, "ab"), "ab");
  assert.equal(r("prefix", { text: "p-" }, "a"), "p-a");
  assert.equal(r("suffix", { text: "-s" }, "a"), "a-s");
  assert.equal(or.runSteps([{ type: "removeProtocol" }, { type: "stripTrailingSlash" }, { type: "lowercase" }], "HTTPS://WWW.Acme.com/"), "acme.com");
});

test("rules are validated, saved, reloaded and deleted", async () => {
  assert.ok(or.validateRule({ label: "x", target: "nope", steps: [{ type: "trim" }] }).length);
  assert.ok(or.validateRule({ label: "x", target: "website", steps: [] }).length);
  assert.ok(or.validateRule({ label: "x", target: "website", steps: [{ type: "bogus" }] }).length);
  assert.ok(or.validateRule({ label: "x", target: "website", steps: [{ type: "replace", find: "" }] }).length);
  assert.ok(or.validateRule({ label: "<b>", target: "website", steps: [{ type: "trim" }] }).length);
  const saved = await or.saveRule({ label: "Facebook handle", target: "smi.facebook", steps: [{ type: "lastPathSegment" }] });
  assert.equal((await or.load()).length, 1);
  assert.equal(or.getCached()[0].id, saved.id);
  await or.removeRule(saved.id);
  assert.equal(or.getCached().length, 0);
});

test("a rule only touches its own target, and never leaves a value empty", () => {
  const doc = { businessEntity: { socialMediaIdentifiers: [
    { network: "Facebook", handleOrUrl: "https://www.facebook.com/Acme/" },
    { network: "Instagram", handleOrUrl: "https://www.instagram.com/acme/" },
    { network: "Twitter/X", handleOrUrl: "https://x.com/AcmeX" }
  ] } };
  const applied = or.apply(doc, [{ id: "1", label: "FB", target: "smi.facebook", steps: [{ type: "lastPathSegment" }] }]);
  assert.deepEqual(doc.businessEntity.socialMediaIdentifiers.map((s) => s.handleOrUrl), ["Acme", "https://www.instagram.com/acme/", "https://x.com/AcmeX"]);
  assert.deepEqual(applied.map((a) => [a.path, a.before, a.after]), [["businessEntity.socialMediaIdentifiers[0].handleOrUrl", "https://www.facebook.com/Acme/", "Acme"]]);
  const blank = { company: { keywords: [{ value: "abc" }] } };
  assert.deepEqual(or.apply(blank, [{ id: "2", label: "wipe", target: "keywords", steps: [{ type: "replace", find: "abc", with: "" }] }]), []);
  assert.equal(blank.company.keywords[0].value, "abc");
  assert.deepEqual(or.apply({ businessEntity: { socialMediaIdentifiers: "oops" } }, [{ id: "3", label: "x", target: "smi.any", steps: [{ type: "lastPathSegment" }] }]), []);
});

// ---- hooked into validation ----

test("on the psypher.in report, a Facebook/Instagram rule changes the values that reach the preview", async () => {
  await or.saveRule({ label: "Handle only", target: "smi.any", steps: [{ type: "lastPathSegment" }] });
  const validated = schema.validate(TEXT_SAMPLE);
  assert.deepEqual(validated.businessEntity.socialMediaIdentifiers.map((s) => [s.network, s.handleOrUrl]), [["Facebook", "psyphergames"], ["Instagram", "psyphergames"]]);
  assert.equal(validated.rulesApplied.length, 2);
  assert.ok(validated.warnings.some((w) => /\[OUTPUT_RULE\] "Handle only" changed 2 value\(s\)/.test(w)));
  await or.removeRule(or.getCached()[0].id);
  assert.equal(schema.validate(TEXT_SAMPLE).businessEntity.socialMediaIdentifiers[0].handleOrUrl, "https://www.facebook.com/psyphergames");
});

// ---- dynamic targets: any field of the report, not a fixed list ----

test("the 'Applies to' list is built from the report's own fields: employee count, address, industry code and more are there", () => {
  const labels = or.targets().map((t) => t.label);
  for (const wanted of ["Employee count", "Address", "City", "State / region", "Country", "Postcode", "Phone", "Start date", "Industry code", "NAICS codes", "Verticals", "Social media: Facebook", "Website Address", "Keywords"]) {
    assert.ok(labels.includes(wanted) || labels.some((l) => l.startsWith(`${wanted} —`)), `"${wanted}" can carry a rule`);
  }
  assert.equal(new Set(or.targets().map((t) => t.id)).size, or.targets().length, "no field is listed twice");
  assert.ok(or.targets().length > 20);
});

test("a new field appears in the list by itself (a taught field), and a rule for it is accepted", () => {
  const before = or.targets().length;
  const original = globalThis.SXRTS.customFields.getCached;
  globalThis.SXRTS.customFields.getCached = () => [{ key: "headcountBand", label: "Headcount band", kind: "single", fields: [{ key: "value", label: "Headcount band" }] }];
  try {
    assert.equal(or.targets().length, before + 1);
    assert.ok(or.targets().some((t) => t.id === "custom:headcountBand:value" && /Headcount band \(taught\)/.test(t.label)));
    assert.deepEqual(or.validateRule({ label: "Band", target: "custom:headcountBand:value", steps: [{ type: "trim" }] }), []);
  } finally { globalThis.SXRTS.customFields.getCached = original; }
});

test("a rule on a report field (state) changes the value that reaches the preview, and only that field", async () => {
  const report = TEXT_SAMPLE.replace(/\* Address: Borivali[^\n]*\n[^\n]*\n/, "* Address: 1 Road\n   * Source: https://www.psypher.in/\n* City: Texas City\n   * Source: https://www.psypher.in/\n* State: TX\n   * Source: https://www.psypher.in/\n");
  const rule = await or.saveRule({ label: "State in full", target: "field:extras.state:value", steps: [{ type: "replace", find: "TX", with: "Texas" }] });
  const validated = schema.validate(report);
  assert.equal(validated.extras.state.value, "Texas");
  assert.equal(validated.extras.city.value, "Texas City", "another field is untouched");
  assert.ok(validated.rulesApplied.some((r) => r.target === "field:extras.state:value" && r.before === "TX" && r.after === "Texas"));
  await or.removeRule(rule.id);
  assert.equal(schema.validate(report).extras.state.value, "TX");
});

test("a rule on a list field (keywords) changes every entry; ids that are not a field are refused; the old ids still work", () => {
  const doc = { company: { keywords: [{ value: " a " }, { value: " b " }] } };
  const applied = or.apply(doc, [{ id: "k", label: "Trim", target: "field:company.keywords:value", steps: [{ type: "trim" }] }]);
  assert.equal(applied.length, 2);
  assert.deepEqual(doc.company.keywords.map((k) => k.value), ["a", "b"]);
  assert.ok(or.validateRule({ label: "x", target: "field:../../etc:value", steps: [{ type: "trim" }] }).length);
  assert.ok(or.validateRule({ label: "x", target: "evil", steps: [{ type: "trim" }] }).length);
  assert.deepEqual(or.validateRule({ label: "x", target: "keywords", steps: [{ type: "trim" }] }), []);
});

// ---- the dialog ----

function setupPanel() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return shadow;
}
const btn = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const type = (input, value) => { input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };

test("dialog: build a rule with a live test, save it, and the preview updates by itself", async () => {
  const shadow = setupPanel();
  shadow.querySelector("#sxrts-response").value = TEXT_SAMPLE;
  btn(shadow, "Validate JSON").click();
  const socialCard = () => Array.from(shadow.querySelectorAll(".action-card")).find((c) => /socialMediaIdentifiers\[0\]/.test(c.querySelector(".action-card-field").textContent));
  const handle = () => Array.from(socialCard().querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === "handleOrUrl").querySelector("input").value;
  assert.equal(handle(), "https://www.facebook.com/psyphergames");

  btn(shadow, "Output rules").click();
  const card = shadow.querySelector(".rules-card");
  assert.match(card.textContent, /No rules yet/);
  btn(card, "Add rule").click();

  // defaults: Facebook + "keep only the last part of the URL"; the live test shows the real current value
  assert.match(card.querySelector(".rules-result").textContent, /→ psyphergames/);
  type(card.querySelector("input[type=text]"), "Facebook handle only");
  btn(card, "Save rule").click();
  await tick(); await tick();

  assert.match(card.textContent, /Facebook handle only/);
  assert.equal(handle(), "psyphergames");
  assert.match(socialCard().textContent, /Output rule "Facebook handle only" changed this value: https:\/\/www\.facebook\.com\/psyphergames → psyphergames/);

  // delete it again: the original value returns
  btn(card, "Delete").click();
  await tick(); await tick();
  assert.equal(handle(), "https://www.facebook.com/psyphergames");
});

test("dialog: an invalid rule is explained, not saved", async () => {
  const shadow = setupPanel();
  btn(shadow, "Output rules").click();
  const card = shadow.querySelector(".rules-card");
  btn(card, "Add rule").click();
  btn(card, "Save rule").click();
  await tick();
  assert.match(card.querySelector(".rules-error").textContent, /Give the rule a name/);
  assert.equal(or.getCached().length, 0);
});

test("dialog: the 'Applies to' box offers the report's other fields, and a rule on Employee count is saved and shown with its field name", async () => {
  const shadow = setupPanel();
  btn(shadow, "Output rules").click();
  const card = shadow.querySelector(".rules-card");
  btn(card, "Add rule").click();
  const select = card.querySelector("select");
  const options = Array.from(select.options).map((o) => o.textContent);
  assert.ok(options.includes("Employee count") && options.includes("Address") && options.includes("Industry code"), options.join(" | "));
  select.value = Array.from(select.options).find((o) => o.textContent === "Employee count").value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  const card2 = shadow.querySelector(".rules-card");
  type(card2.querySelector("input[type=text]"), "Employee count tidy");
  // the first step is "keep only the last part of the URL"; change it to a trim
  const stepSelect = card2.querySelectorAll("select")[1];
  stepSelect.value = "trim";
  stepSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  btn(shadow.querySelector(".rules-card"), "Save rule").click();
  await tick(); await tick();
  const list = shadow.querySelector(".rules-card").textContent;
  assert.match(list, /Employee count tidy/);
  assert.match(list, /Employee count: Trim spaces/);
});

// ---- phone numbers the way RTS asks for them ----
test("the US phone step writes 281-941-6001 and leaves every other number exactly as it is", () => {
  const f = (v) => or.runSteps([{ type: "phoneUS" }], v);
  assert.equal(f("281-941-6001"), "281-941-6001");
  assert.equal(f("(281) 941-6001"), "281-941-6001");
  assert.equal(f("281.941.6001"), "281-941-6001");
  assert.equal(f("+1 281 941 6001"), "281-941-6001");
  assert.equal(f("1-281-941-6001"), "281-941-6001");
  assert.equal(f("2819416001"), "281-941-6001");
  assert.equal(f("+91 98765 43210"), "+91 98765 43210", "another country's number is not touched");
  assert.equal(f("941-6001"), "941-6001", "an incomplete number is not guessed");
  assert.equal(f("+44 20 7946 0958"), "+44 20 7946 0958");
});

test("a phone rule changes the phone that reaches the preview, for the text report and for a company.sites record", () => {
  const rule = { id: "p", label: "Phone as 281-941-6001", target: "field:extras.phone:value", steps: [{ type: "phoneUS" }], enabled: true };
  assert.deepEqual(or.validateRule(rule), []);
  const doc = { extras: { phone: { value: "(281) 941-6001", action: "addIfMissing" } }, company: { sites: [{ city: "Texas City", phone: "281.941.6001" }] } };
  const applied = or.apply(doc, [rule, { ...rule, id: "q", target: "field:company.sites:phone" }]);
  assert.equal(doc.extras.phone.value, "281-941-6001");
  assert.equal(doc.company.sites[0].phone, "281-941-6001");
  assert.equal(applied.length, 2);
});

// ---- your own conditions and the phone by country ----
const run = (steps, value, ctx) => or.runSteps(steps, value, ctx);

test("'If the number is between … and …': a number or a range inside is replaced; anything else is left alone", () => {
  const step = [{ type: "ifBetween", from: "2", to: "10", then: "2-10" }];
  assert.equal(run(step, "7"), "2-10");
  assert.equal(run(step, "2"), "2-10");
  assert.equal(run(step, "10"), "2-10");
  assert.equal(run(step, "11"), "11");
  assert.equal(run(step, "1"), "1");
  assert.equal(run(step, "5-8"), "2-10", "a range that lies inside");
  assert.equal(run(step, "5-80"), "5-80", "a range that does not");
  assert.equal(run(step, "1,200"), "1,200", "thousands separators are understood");
  assert.equal(run(step, "Not disclosed"), "Not disclosed");
  assert.equal(run([{ type: "ifBetween", from: "11", to: "50", then: "11-50" }], "25 employees"), "11-50");
});

test("the other conditions: equals, contains, starts with, ends with, and a list of pairs", () => {
  assert.equal(run([{ type: "ifEquals", text: "usa", then: "United States" }], "USA"), "United States");
  assert.equal(run([{ type: "ifEquals", text: "usa", then: "United States" }], "USA Inc"), "USA Inc");
  assert.equal(run([{ type: "ifContains", text: "pvt", then: "Private Limited" }], "Acme Pvt Ltd"), "Private Limited");
  assert.equal(run([{ type: "ifStartsWith", text: "www.", then: "site" }], "WWW.acme.com"), "site");
  assert.equal(run([{ type: "ifEndsWith", text: ".io", then: "tech" }], "acme.io"), "tech");
  const pairs = [{ type: "mapValues", pairs: "2-10=Small; 11-50=Medium; 51-200=Large" }];
  assert.equal(run(pairs, "11-50"), "Medium");
  assert.equal(run(pairs, "51-200"), "Large");
  assert.equal(run(pairs, "500"), "500");
  assert.equal(run([{ type: "mapValues", pairs: "a=b=c" }], "a"), "b=c");
});

test("your own steps chain: the first that matches changes the value, and later steps see the result", () => {
  const steps = [{ type: "ifBetween", from: "1", to: "1", then: "1-1" }, { type: "ifBetween", from: "2", to: "10", then: "2-10" }, { type: "mapValues", pairs: "2-10=Micro" }];
  assert.equal(run(steps, "5"), "Micro");
  assert.equal(run(steps, "20"), "20");
});

test("steps are validated: numbers where numbers are needed, pairs where pairs are needed, and never empty by accident", () => {
  const ok = (steps) => or.validateRule({ label: "x", target: "field:extras.employeeCount:value", steps });
  assert.deepEqual(ok([{ type: "ifBetween", from: "2", to: "10", then: "2-10" }]), []);
  assert.match(ok([{ type: "ifBetween", from: "two", to: "10", then: "x" }]).join(" "), /must be numbers/);
  assert.match(ok([{ type: "ifBetween", from: "", to: "10", then: "x" }]).join(" "), /must be numbers/);
  assert.match(ok([{ type: "mapValues", pairs: "no pairs here" }]).join(" "), /pairs like/);
  assert.match(ok([{ type: "phoneByCountry", formats: "Germany=no digits" }]).join(" "), /with # for each digit/);
  assert.deepEqual(ok([{ type: "phoneByCountry", formats: "Germany=+49 ## ########; India=+91 ##### #####" }]), []);
  assert.deepEqual(ok([{ type: "phoneByCountry" }]), [], "empty = the built-in US and Canada formats");
  assert.match(ok([{ type: "ifEquals", text: "a\nb", then: "c" }]).join(" "), /short plain text/);
});

test("a rule on the employee count changes the value that reaches the preview", () => {
  const doc = { extras: { employeeCount: { value: "7", action: "addIfMissing" } } };
  const rule = { id: "e", label: "Employees 2-10", target: "field:extras.employeeCount:value", steps: [{ type: "ifBetween", from: "2", to: "10", then: "2-10" }], enabled: true };
  const applied = or.apply(doc, [rule]);
  assert.equal(doc.extras.employeeCount.value, "2-10");
  assert.equal(applied.length, 1);
});

test("the phone is written for the country it belongs to: US and Canada built in, any other country from your own list", () => {
  const phone = [{ type: "phoneByCountry", formats: "Germany=+49 ## ########; India=+91 ##### #####; United Kingdom=+44 #### ######" }];
  assert.equal(run(phone, "(281) 941-6001", { country: "USA" }), "281-941-6001");
  assert.equal(run(phone, "+1 281 941 6001", { country: "United States" }), "281-941-6001");
  assert.equal(run(phone, "416.555.0199", { country: "Canada" }), "416-555-0199");
  assert.equal(run(phone, "+49 3012345678", { country: "Germany" }), "+49 30 12345678");
  assert.equal(run(phone, "9876543210", { country: "India" }), "+91 98765 43210");
  assert.equal(run(phone, "+91 98765 43210", { country: "India" }), "+91 98765 43210");
  assert.equal(run(phone, "+44 20 7946 0958", { country: "UK" }), "+44 2079 460958");
  assert.equal(run(phone, "01 23 45 67 89", { country: "France" }), "01 23 45 67 89", "a country with no format is left exactly as it is");
  assert.equal(run(phone, "281-941-6001", {}), "281-941-6001", "no country, no change");
  assert.equal(run(phone, "941-6001", { country: "USA" }), "941-6001", "an incomplete number is not guessed");
});

test("the country comes from the same record: a site's own country, else the report's country", () => {
  const rule = { id: "p", label: "Phone by country", target: "field:company.sites:phone", steps: [{ type: "phoneByCountry", formats: "India=+91 ##### #####" }], enabled: true };
  const doc = { company: { sites: [{ city: "Pune", country: "India", phone: "9876543210" }, { city: "Austin", country: "USA", phone: "(512) 555-0100" }] } };
  or.apply(doc, [rule]);
  assert.deepEqual(doc.company.sites.map((x) => x.phone), ["+91 98765 43210", "512-555-0100"]);
  const text = { extras: { country: { value: "Canada" }, phone: { value: "(416) 555-0199" } } };
  or.apply(text, [{ ...rule, target: "field:extras.phone:value" }]);
  assert.equal(text.extras.phone.value, "416-555-0199");
});

test("dialog: you build your own condition — if the employee count is between 2 and 10, set 2-10 — and it is saved and applied", async () => {
  const shadow = setupPanel();
  btn(shadow, "Output rules").click();
  const card = shadow.querySelector(".rules-card");
  btn(card, "Add rule").click();
  const target = card.querySelector("select");
  target.value = Array.from(target.options).find((o) => o.textContent === "Employee count").value;
  target.dispatchEvent(new window.Event("change", { bubbles: true }));
  let c = shadow.querySelector(".rules-card");
  type(c.querySelector("input[type=text]"), "Employees 2-10");
  const stepType = c.querySelectorAll("select")[1];
  assert.ok(Array.from(stepType.options).some((o) => /If the number is between/.test(o.textContent)), "the new steps are offered");
  stepType.value = "ifBetween";
  stepType.dispatchEvent(new window.Event("change", { bubbles: true }));
  c = shadow.querySelector(".rules-card");
  const boxes = Array.from(c.querySelectorAll(".rules-step input[type=text]"));
  assert.deepEqual(boxes.map((b) => b.placeholder), ["from, e.g. 2", "to, e.g. 10", "replace the value with, e.g. 2-10"]);
  type(boxes[0], "2"); type(boxes[1], "10"); type(boxes[2], "2-10");
  btn(c, "Save rule").click();
  await tick(); await tick();
  const saved = or.getCached().find((r) => r.label === "Employees 2-10");
  assert.deepEqual(saved.steps, [{ type: "ifBetween", from: "2", to: "10", then: "2-10" }]);
  assert.match(shadow.querySelector(".rules-card").textContent, /If the number is between/);
  const doc = { extras: { employeeCount: { value: "7", action: "addIfMissing" } } };
  or.apply(doc);
  assert.equal(doc.extras.employeeCount.value, "2-10");
  await or.removeRule(saved.id);
});
