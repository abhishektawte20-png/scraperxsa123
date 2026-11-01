// Check mappings: read-only. Every part of a mapping is looked for on the page; nothing is typed, ticked or saved.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import { setup as naicsSetup } from "./helpers/naics-dialog.mjs";
import { setup as siteSetup } from "./helpers/site-dialog.mjs";
import "../core/outputFields.js";
import "../core/mappingCheck.js";

const wf = () => globalThis.SXRTS.workflows;
const mc = () => globalThis.SXRTS.mappingCheck;

const naicsDef = {
  key: "companyNaicsCodes", label: "NAICS codes", description: "", kind: "record",
  fields: [{ key: "code", kind: "tree", selectors: [] }],
  openButton: { selectors: ['[data-test-id="naics-add-button"]'], text: "Add NAICS" },
  saveButton: { selectors: ['[data-test-id="naics-modal-save-button"]'], text: "Save" },
  tree: { kind: "naics", expander: { selectors: ['input[name="tree-expander"]'] }, leaf: { selectors: ["input.radio-button__handler"] }, sectionSave: { selectors: ['[data-test-id="naics-save-button"]'], text: "Save Changes" } },
  binds: { path: "company.naicsCodes", map: { code: "code" } }
};
const part = (result, name) => result.parts.find((p) => p.name === name);

test("NAICS: every part is found, the dialog is closed again, and nothing was chosen or saved", async () => {
  const { state, dlg } = naicsSetup();
  const result = await wf().customField.checkField(naicsDef);
  assert.ok(result.parts.every((p) => p.ok), JSON.stringify(result.parts.filter((p) => !p.ok)));
  assert.ok(part(result, "+ buttons") && part(result, "Code radio buttons") && part(result, "Dialog's Save button") && part(result, "Section's Save Changes"));
  assert.equal(dlg.style.display, "none", "the dialog was closed again");
  assert.equal(state.saves + state.sectionSaves, 0);
  assert.deepEqual(state.listed, []);
  assert.equal(mc().statusOf(result), "ok");
});

test("NAICS: a mapping whose radio button no longer matches is reported as not found, and the dialog is still closed", async () => {
  const { dlg } = naicsSetup();
  const broken = { ...naicsDef, tree: { ...naicsDef.tree, leaf: { selectors: ["input.gone-class"] } } };
  const result = await wf().customField.checkField(broken);
  assert.equal(part(result, "Code radio buttons").ok, false);
  assert.equal(mc().statusOf(result), "fail");
  assert.equal(dlg.style.display, "none");
});

test("NAICS: with no Add button on the page it says so (the other tabs are tried first)", async () => {
  const { doc } = naicsSetup();
  doc.getElementById("addNaics").remove();
  const result = await wf().customField.checkField(naicsDef);
  assert.equal(mc().statusOf(result), "fail");
  assert.match(result.parts[0].note, /not on this page/);
});

test("Site: every box, the choices Primary HQ and Current, and SAVE are found; the form is cancelled; nothing is saved", async () => {
  const { state, doc } = siteSetup();
  const result = await wf().companySite.check();
  assert.ok(result.parts.every((p) => p.ok), JSON.stringify(result.parts.filter((p) => !p.ok)));
  assert.ok(part(result, 'Site type offers "Primary HQ"') && part(result, 'Status offers "Current"') && part(result, "SAVE button"));
  assert.equal(state.saves, 0);
  assert.equal(state.cancels, 1);
  assert.equal(doc.getElementById("siteForm").style.display, "none");
});

test("Site: a box RTS removed is reported by name", async () => {
  const { doc } = siteSetup();
  const original = doc.getElementById("addSite");
  original.addEventListener("click", () => doc.querySelector('select[name="site.siteStatus.id"]')?.closest("tr")?.remove());
  const result = await wf().companySite.check();
  assert.equal(part(result, "Status").ok, false);
  assert.equal(mc().statusOf(result), "fail");
});

function pageWith(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  return window;
}

test("a field on the page itself: found, and a missing box or Save button is named; nothing is typed", async () => {
  pageWith('<textarea id="brief">keep me</textarea><button id="save" disabled>Save Changes</button>');
  const def = { key: "brief", label: "Brief description", kind: "single", fields: [{ key: "value", label: "Brief", kind: "text", selectors: ["#brief"] }], saveButton: { selectors: ["#save"], text: "Save Changes" }, binds: { path: "company.briefDescription", map: { value: "value" } } };
  const ok = await wf().customField.checkField(def);
  assert.equal(mc().statusOf(ok), "ok");
  assert.equal(document.getElementById("brief").value, "keep me");
  const broken = await wf().customField.checkField({ ...def, fields: [{ ...def.fields[0], selectors: ["#nope"] }], saveButton: { selectors: ["#nosave"], text: "Gone" } });
  assert.equal(mc().statusOf(broken), "fail");
  assert.equal(part(broken, "Brief").ok, false);
  assert.equal(part(broken, "Save button").ok, false);
});

test("a form that opens from a button: the button is pressed, the boxes are looked for, and it is closed again", async () => {
  const window = pageWith('<input type="button" id="open" value="Add New Employee Count"><div id="form" style="display:none"><input name="records.0.employeeCount"><button id="saveEh" disabled>Save EH</button><button id="closeEh">Close</button></div>');
  let opens = 0;
  document.getElementById("open").addEventListener("click", () => { opens++; document.getElementById("form").style.display = ""; });
  document.getElementById("closeEh").addEventListener("click", () => { document.getElementById("form").style.display = "none"; });
  const def = { key: "emp", label: "Employee count", kind: "single", fields: [{ key: "value", label: "Count", kind: "text", selectors: ['input[name="records.0.employeeCount"]'] }], openButton: { selectors: ["#open"], text: "Add New Employee Count" }, saveButton: { selectors: ["#saveEh"], text: "Save EH" }, closeButton: { selectors: ["#closeEh"], text: "Close" } };
  const result = await wf().customField.checkField(def);
  assert.equal(mc().statusOf(result), "ok", JSON.stringify(result.parts));
  assert.equal(opens, 1);
  assert.equal(document.getElementById("form").style.display, "none");
  void window;
});

test("a field in a separate window: the worker is asked for a read-only check job, and its answer becomes the parts", async () => {
  pageWith('<input type="button" id="open" value="Add/Edit Industry">');
  const jobs = [];
  global.chrome = { runtime: { connect() {
    const listeners = [];
    return { onMessage: { addListener: (fn) => listeners.push(fn) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(message) {
      jobs.push(message.job);
      setTimeout(() => listeners.forEach((fn) => fn({ type: "armed" })), 5);
      setTimeout(() => listeners.forEach((fn) => fn({ type: "result", result: { status: "checked", parts: [{ name: "+ buttons", ok: true, note: "7 found" }, { name: "Choices (tick boxes)", ok: true, note: "274 found" }, { name: "Save button", ok: true, note: "" }] } })), 20);
    } };
  } } };
  const def = { key: "ind", label: "Industry code", kind: "single", fields: [{ key: "value", kind: "tree", label: "Industry code", selectors: [] }], openButton: { selectors: ["#open"], text: "Add/Edit Industry" }, saveButton: { selectors: ["#save"], text: "Save Changes" }, window: { path: "/x", preSave: [], tree: { expander: { selectors: ["div.x"] }, leaf: { selectors: ["div.l"] } } }, binds: { path: "extras.industryCode", map: { value: "value" } } };
  const result = await wf().customField.checkField(def);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].check, true);
  assert.deepEqual(jobs[0].tree.leaf.selectors, ["div.l"]);
  assert.equal(mc().statusOf(result), "ok");
  assert.equal(part(result, "Choices (tick boxes)").note, "274 found");
});

test("the whole check: counts, the built-in Site, a taught field, and the tab that was open is shown again", async () => {
  const { doc, state } = siteSetup({ otherTab: true });
  const cf = globalThis.SXRTS.customFields;
  const original = cf.getCached;
  cf.getCached = () => [{ key: "brief", label: "Brief description", kind: "single", fields: [{ key: "value", label: "Brief", kind: "text", selectors: ["#nowhere"] }], saveButton: { selectors: ["#nosave"], text: "Save" }, binds: { path: "company.briefDescription", map: { value: "value" } } }];
  doc.getElementById("tabEntity").classList.add("active");
  try {
    const progress = [];
    const result = await mc().run((p) => progress.push(p.done));
    assert.deepEqual(result.rows.map((r) => [r.label, r.status]), [["Site (one form)", "ok"], ["Brief description", "fail"]]);
    assert.deepEqual([result.ok, result.warn, result.fail], [1, 0, 1]);
    assert.equal(state.saves, 0);
    assert.ok(progress.length >= 3);
    assert.equal(doc.getElementById("entityTab").style.display, "", "the Business Entity tab was open before and is shown again");
    assert.match(mc().asText(result), /FAIL Brief description/);
    assert.match(mc().asText(result), /OK   Site \(one form\)/);
  } finally { cf.getCached = original; }
});

test("a taught Site mapping is not checked when the built-in Site is there (it is never used)", async () => {
  siteSetup();
  const cf = globalThis.SXRTS.customFields;
  const original = cf.getCached;
  cf.getCached = () => [{ key: "city", label: "City", kind: "single", fields: [{ key: "value", kind: "text", selectors: ["#x"] }], saveButton: { selectors: ["#y"], text: "Save" }, binds: { path: "extras.city", map: { value: "value" } } }];
  try {
    const result = await mc().run();
    assert.deepEqual(result.rows.map((r) => r.label), ["Site (one form)"]);
  } finally { cf.getCached = original; }
});
