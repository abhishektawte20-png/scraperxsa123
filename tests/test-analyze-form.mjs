// A whole form as ONE mapping: made with "Analyze page" (scan, press the opening button, choose which box takes which
// report value or a fixed value, Save), then published: the form is opened, filled and saved once.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/selectorBuilder.js";
import "../core/outputFields.js";
import "../core/customFields.js";
import "../core/pageAnalysis.js";
import "../core/workflows/customField.js";
import "../content/analyze.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const cf = () => globalThis.SXRTS.customFields;

function setup() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="mgmt"><h3>Management</h3><ul id="people"></ul>
      <input type="button" id="addPos" class="btn" value="Add New Management Position">
      <form id="posForm" style="display:none"><h3>Management position</h3><table>
        <tr><td>Full name*</td><td><input name="person.fullName"></td></tr>
        <tr><td>Job title</td><td><input name="position.title"></td></tr>
        <tr><td>Relationship*</td><td><select name="position.relationship"><option value=""></option><option value="1">Executive</option><option value="2">Board Member</option></select></td></tr>
      </table><input type="button" id="savePos" value="Save Changes" disabled><input type="button" id="cancelPos" value="Cancel"></form></div></body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLTextAreaElement: window.HTMLTextAreaElement, Event: window.Event, InputEvent: window.InputEvent, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = { runtime: { connect() { throw new Error("no worker in this test"); } }, storage: { local: { async get(k) { return store.has(k) ? { [k]: JSON.parse(JSON.stringify(store.get(k))) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, JSON.parse(JSON.stringify(v))); }, async remove(k) { store.delete(k); } } } };
  const state = { opens: 0, saves: 0, last: null, cancels: 0 };
  const form = document.getElementById("posForm");
  const save = document.getElementById("savePos");
  document.getElementById("addPos").addEventListener("click", () => { state.opens++; form.style.display = ""; });
  document.getElementById("cancelPos").addEventListener("click", () => { state.cancels++; form.style.display = "none"; });
  form.addEventListener("input", () => { save.disabled = !(form.querySelector('[name="person.fullName"]').value && form.querySelector("select").value); });
  form.addEventListener("change", () => { save.disabled = !(form.querySelector('[name="person.fullName"]').value && form.querySelector("select").value); });
  save.addEventListener("click", () => {
    state.saves++;
    state.last = { name: form.querySelector('[name="person.fullName"]').value, title: form.querySelector('[name="position.title"]').value, relationship: form.querySelector("select").selectedOptions[0].textContent };
    document.getElementById("people").insertAdjacentHTML("beforeend", `<li>${state.last.name} — ${state.last.title}</li>`);
    form.style.display = "none";
    save.disabled = true;
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  return { state, shadow };
}
const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
const selectWith = (root, text) => Array.from(root.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.textContent === text));
const change = (select, value) => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })); };

test("Analyze page: scan, press the button that opens the form, map the whole form (names from the report, a fixed relationship, one Save), and publish it", async () => {
  const { state, shadow } = setup();
  await cf().load();
  let mapped = null;
  const ui = globalThis.SXRTS.analyzeUi.mount(shadow, { onMapped: (label) => { mapped = label; } });
  ui.open();

  byText(shadow, "Scan this page").click();
  await tick(80);
  assert.match(shadow.textContent, /Add New Management Position/);
  assert.equal(state.opens + state.saves, 0, "scanning pressed nothing");

  // The button that opens the form, then press it and read what appeared.
  const openerSelect = selectWith(shadow, "Add New Management Position");
  change(openerSelect, String(Array.from(openerSelect.options).findIndex((o) => o.textContent === "Add New Management Position") - 1));
  byText(shadow, "Press it and scan").click();
  await tick(1500);
  assert.equal(state.opens, 1, "the button was pressed once");
  assert.match(shadow.textContent, /showed 5 new control/);
  assert.match(shadow.textContent, /Full name/);

  // It guessed the report field and the boxes; the Save button was found.
  const target = selectWith(shadow, "Management");
  assert.equal(target.value, "extras.management");
  const rows = Array.from(shadow.querySelectorAll(".hx-row")).filter((r) => /→/.test(r.textContent));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector("select").value, "fullName");
  assert.equal(rows[1].querySelector("select").value, "title");
  assert.equal(rows[2].querySelector("select").value, "", "the relationship has no report value");

  // Relationship: always "Executive".
  change(rows[2].querySelector("select"), "__fixed");
  await tick(10);
  const fixedRow = Array.from(shadow.querySelectorAll(".hx-row")).filter((r) => /→/.test(r.textContent))[2];
  assert.ok(fixedRow.querySelectorAll("select")[1], "the choices of the dropdown are offered");
  change(fixedRow.querySelectorAll("select")[1], "Executive");
  assert.equal(selectWith(shadow, "Save Changes").selectedOptions[0].textContent, "Save Changes");

  byText(shadow, "Create mapping").click();
  await tick(60);
  assert.equal(mapped, "Management");
  const def = cf().getBoundDef("extras.management");
  assert.ok(def, "the mapping is stored");
  assert.deepEqual([def.kind, def.form], ["record", true]);
  assert.deepEqual(def.openButton.text, "Add New Management Position");
  assert.deepEqual(def.fields.map((f) => [f.label, f.fixed ?? null]), [["Full name", null], ["Job title", null], ["Relationship", "Executive"]]);
  assert.deepEqual(Object.values(def.binds.map).sort(), ["fullName", "title"]);
  assert.equal(state.saves, 0, "creating the mapping saved nothing");

  // Publish a person with the mapping that was just made: open, fill every box, Save once.
  const record = cf().normalizeRecord(def, cf().toDefRecord(def, { fullName: "Jane Doe", title: "Chief Executive Officer", action: "addIfMissing" }));
  const result = await globalThis.SXRTS.workflows.customField.applyCustomField(def, record);
  assert.equal(result.status, "savedStateVerified", "the form closes itself on Save, so only the state can be confirmed, and it says so");
  assert.match(result.detail, /closed by itself/);
  assert.equal(state.saves, 1);
  assert.deepEqual(state.last, { name: "Jane Doe", title: "Chief Executive Officer", relationship: "Executive" });
  assert.equal(document.getElementById("posForm").style.display, "none");

  // Check mappings on the new mapping: found, and the form is put away with its own Cancel button; nothing is saved.
  assert.deepEqual(def.closeButton.text, "Cancel");
  const savesBefore = state.saves;
  const check = await globalThis.SXRTS.workflows.customField.checkField(def);
  assert.ok(check.parts.every((p) => p.ok), JSON.stringify(check.parts));
  assert.equal(state.saves, savesBefore);
  assert.equal(state.cancels, 1, "the form was put away with its Cancel button");
  assert.equal(document.getElementById("posForm").style.display, "none");
});

test("a form needs a report value for at least one box, a Save button and a field: the mapping is refused with the reason", async () => {
  const { shadow } = setup();
  await cf().load();
  const ui = globalThis.SXRTS.analyzeUi.mount(shadow);
  ui.open();
  byText(shadow, "Scan this page").click();
  await tick(60);
  const openerSelect = selectWith(shadow, "Add New Management Position");
  change(openerSelect, String(Array.from(openerSelect.options).findIndex((o) => o.textContent === "Add New Management Position") - 1));
  byText(shadow, "Press it and scan").click();
  await tick(1500);
  for (const row of Array.from(shadow.querySelectorAll(".hx-row")).filter((r) => /→/.test(r.textContent))) change(row.querySelector("select"), "");
  byText(shadow, "Create mapping").click();
  await tick(30);
  assert.match(shadow.textContent, /Choose a report value/);
  assert.equal(cf().getBoundDef("extras.management"), null);
});

test("a fixed value that is not one of the dropdown's choices, or a fixed value on a box with no report box, is refused by the definition check", () => {
  const base = { key: "extrasManagement", label: "Management", description: "", kind: "record", form: true, saveButton: { selectors: ["#s"], text: "Save" }, openButton: { selectors: ["#o"], text: "Add" }, binds: { path: "extras.management", map: { fullName: "fullName" } } };
  const name = { key: "fullName", label: "Full name", description: "", kind: "text", selectors: ["#n"] };
  const rel = { key: "relationship", label: "Relationship", description: "", kind: "select", selectors: ["#r"], options: [{ label: "Executive", value: "1" }], fixed: "Executive" };
  assert.deepEqual(cf().validateDefinition({ ...base, fields: [name, rel] }), []);
  assert.match(cf().validateDefinition({ ...base, fields: [name, { ...rel, fixed: "Astronaut" }] }).join(" "), /not one of the dropdown's choices/);
  assert.match(cf().validateDefinition({ ...base, form: undefined, fields: [name, rel] }).join(" "), /fixed value is only for a whole-form mapping/);
  assert.match(cf().validateDefinition({ ...base, fields: [{ ...rel }], binds: { path: "extras.management", map: {} } }).join(" "), /At least one box must be filled from the report/);
});
