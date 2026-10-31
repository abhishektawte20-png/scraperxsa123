import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-general.html"), "utf8");
function fakeChrome() {
  const data = {};
  global.chrome = { storage: { local: {
    get: async (k) => (typeof k === "string" ? { [k]: data[k] } : { ...data }),
    set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    remove: async (k) => { delete data[k]; }
  } } };
  return data;
}

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/workflows/businessEntityGeneral.js";
import "../core/undoLedger.js";

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>${fixtureHtml}</body></html>`, { runScripts: "outside-only" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  global.HTMLSelectElement = window.HTMLSelectElement;
  global.Event = window.Event;
  global.InputEvent = window.InputEvent;
  window.HTMLElement.prototype.scrollIntoView = () => {};

  const saveButton = document.getElementById("saveBusinessEntityButton");
  for (const selector of ["#webURL", 'select[name="businessEntity.emailDefaultStructure.id"]', ".highlight-textarea"]) {
    document.querySelector(selector).addEventListener("input", () => { saveButton.disabled = false; });
    document.querySelector(selector).addEventListener("change", () => { saveButton.disabled = false; });
  }
  saveButton.addEventListener("click", () => {
    setTimeout(() => { saveButton.disabled = true; }, 30);
  });

  return dom;
}


const { undoLedger } = globalThis.SXRTS;
const { businessEntityGeneral } = globalThis.SXRTS.workflows;

test("each kind of published item gets the right undo plan", () => {
  const plan = (item) => undoLedger.planFor(item);
  assert.deepEqual([plan({ path: "extras.industryCode", customKey: "ind", treeWindow: true }).kind, plan({ path: "extras.industryCode", customKey: "ind", treeWindow: true }).auto], ["industry", true]);
  assert.equal(plan({ path: "businessEntity.websiteAddresses", before: "" }).auto, true, "an empty website can be emptied again");
  assert.equal(plan({ path: "businessEntity.websiteAddresses" }).auto, false, "unknown previous value: by hand");
  assert.equal(plan({ path: "businessEntity.emailDefaultStructure", before: "" }).auto, false, "an empty select cannot be put back");
  assert.equal(plan({ path: "businessEntity.emailDefaultStructure", before: "First.Last" }).auto, true);
  assert.equal(plan({ path: "company.keywords[2]", customKey: "kw" }).kind, "manual");
  assert.match(plan({ path: "businessEntity.nameVariations[0]" }).hint, /Name Variations/);
});

test("a run is stored, listed newest first, marked, and erased after its retention period", async () => {
  fakeChrome();
  const id = await undoLedger.record({ domain: "a.com", company: "A", items: [{ path: "businessEntity.websiteAddresses", label: "Website", value: "www.a.com", before: "" }] }, 1000);
  await undoLedger.record({ domain: "b.com", company: "B", items: [{ path: "company.keywords[0]", label: "Keywords", value: "x" }] }, 2000);
  assert.deepEqual((await undoLedger.list(3000)).map((r) => r.company), ["B", "A"]);
  await undoLedger.markItem(id, "0", "undone", "ok");
  assert.equal((await undoLedger.list(3000)).find((r) => r.id === id).items[0].state, "undone");
  assert.equal((await undoLedger.list(1000 + 16 * 86400000)).length, 0, "both are older than 15 days");
  assert.equal(await undoLedger.record({ domain: "c", items: [] }), null, "nothing saved, nothing to undo");
});

test("website address: a replaced value is put back and read back; one that was empty is emptied", async () => {
  setupDom();
  document.getElementById("webURL").value = "www.old.com";
  const replaced = await businessEntityGeneral.applyBusinessEntityGeneral({ websiteAddresses: [{ value: "www.new.com", action: "replaceAfterConfirmation" }] });
  assert.equal(replaced.results.websiteAddresses.before, "www.old.com", "the workflow reports what was there before");
  let r = await undoLedger.undoItem({ kind: "website", before: "www.old.com", value: "www.new.com" });
  assert.deepEqual([r.ok, document.getElementById("webURL").value], [true, "www.old.com"]);

  setupDom();
  const added = await businessEntityGeneral.applyBusinessEntityGeneral({ websiteAddresses: [{ value: "www.fresh.com", action: "addIfMissing" }] });
  assert.equal(added.results.websiteAddresses.before, "");
  r = await undoLedger.undoItem({ kind: "website", before: "", value: "www.fresh.com" });
  assert.deepEqual([r.ok, document.getElementById("webURL").value], [true, ""]);
});

test("email default structure is put back to the previous choice", async () => {
  setupDom();
  const select = document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]');
  const labels = [...select.options].map((o) => o.textContent.trim()).filter(Boolean);
  select.value = [...select.options].find((o) => o.textContent.trim() === labels[0]).value;
  const replaced = await businessEntityGeneral.applyBusinessEntityGeneral({ emailDefaultStructure: { value: labels[1], action: "replaceAfterConfirmation" } });
  assert.equal(replaced.results.emailDefaultStructure.before, labels[0]);
  assert.equal(select.selectedOptions[0].textContent.trim(), labels[1]);
  const r = await undoLedger.undoItem({ kind: "email", before: labels[0], value: labels[1] });
  assert.deepEqual([r.ok, select.selectedOptions[0].textContent.trim()], [true, labels[0]]);
});

test("an undo that RTS does not confirm is reported as failed, never as done", async () => {
  setupDom();
  document.getElementById("saveBusinessEntityButton").replaceWith(document.getElementById("saveBusinessEntityButton").cloneNode(true)); // a Save that never settles
  const r = await undoLedger.undoItem({ kind: "website", before: "x", value: "y" });
  assert.equal(r.ok, false);
  assert.ok(r.message);
});

test("a hand-removal item is never attempted by the extension", async () => {
  const r = await undoLedger.undoItem({ kind: "manual", label: "Keywords", value: "x" });
  assert.equal(r.ok, false);
  assert.match(r.message, /by hand/);
});
