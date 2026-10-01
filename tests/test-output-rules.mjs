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
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/promptBuilder.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../content/rules.js";
import "../content/panel.js";
import { TEXT_SAMPLE } from "./helpers/rovo-text-sample.mjs";

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
