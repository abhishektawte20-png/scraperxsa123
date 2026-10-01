// Taught-field workflow against a jsdom page that simulates the RTS Save
// behaviour (button enables on edit, returns to disabled after a save).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/customFields.js";
import "../core/selectorBuilder.js";
import "../core/workflows/customField.js";

const store = new Map();
global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };

const single = {
  key: "foundedYear", label: "Founded year", description: "", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: ["#foundedYear"] }],
  saveButton: { selectors: ["#saveCompany"], text: "Save" }
};
const select = {
  key: "tier", label: "Tier", description: "", kind: "single",
  fields: [{ key: "value", kind: "select", selectors: ["select#tier"], options: [{ label: "Gold", value: "G" }, { label: "Silver", value: "S" }] }],
  saveButton: { selectors: ["#saveCompany"], text: "Save" }
};
const record = {
  key: "awards", label: "Awards", description: "", kind: "record",
  fields: [
    { key: "title", kind: "text", selectors: ["input.awardTitle"] },
    { key: "level", kind: "select", selectors: ["select.awardLevel"], options: [{ label: "Gold", value: "G" }, { label: "Silver", value: "S" }] }
  ],
  addButton: { selectors: ["#addAward"], text: "Add" },
  saveButton: { selectors: ["#saveAwards"], text: "Save" }
};

function setup({ saveDisables = true, foundedYear = "" } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="foundedYear" value="${foundedYear}">
    <select id="tier"><option value="">--</option><option value="G">Gold</option><option value="S">Silver</option></select>
    <button id="saveCompany" disabled>Save</button>
    <div id="awards"></div>
    <button id="addAward" type="button">Add</button>
    <button id="saveAwards" disabled>Save</button>
  </body>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};

  const doc = window.document;
  const enable = (id) => () => { doc.getElementById(id).disabled = false; };
  for (const id of ["foundedYear", "tier"]) {
    doc.getElementById(id).addEventListener("input", enable("saveCompany"));
    doc.getElementById(id).addEventListener("change", enable("saveCompany"));
  }
  const settle = (id) => () => { if (saveDisables) setTimeout(() => { doc.getElementById(id).disabled = true; }, 30); };
  doc.getElementById("saveCompany").addEventListener("click", settle("saveCompany"));
  doc.getElementById("saveAwards").addEventListener("click", settle("saveAwards"));
  doc.getElementById("addAward").addEventListener("click", () => {
    const row = doc.createElement("div");
    row.innerHTML = '<input class="awardTitle"><select class="awardLevel"><option value="">--</option><option value="G">Gold</option><option value="S">Silver</option></select>';
    doc.getElementById("awards").appendChild(row);
    for (const control of row.querySelectorAll("input, select")) {
      control.addEventListener("input", enable("saveAwards"));
      control.addEventListener("change", enable("saveAwards"));
    }
  });
  return doc;
}

const run = (def, rec) => globalThis.SXRTS.workflows.customField.applyCustomField(def, rec);

test("single text field: writes, clicks Save, and verifies the saved value", async () => {
  const doc = setup();
  const result = await run(single, { value: "1997", action: "addIfMissing" });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(doc.getElementById("foundedYear").value, "1997");
  assert.equal(doc.getElementById("saveCompany").disabled, true);
});

test("single dropdown field: selects the option by label and verifies", async () => {
  const doc = setup();
  const result = await run(select, { value: "silver", action: "addIfMissing" });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(doc.getElementById("tier").value, "S");
});

test("an existing value is left alone unless the action is replaceAfterConfirmation", async () => {
  const doc = setup({ foundedYear: "1990" });
  const skipped = await run(single, { value: "1997", action: "addIfMissing" });
  assert.equal(skipped.status, "skipped");
  assert.equal(doc.getElementById("foundedYear").value, "1990");
  const replaced = await run(single, { value: "1997", action: "replaceAfterConfirmation" });
  assert.equal(replaced.status, "savedValueVerified");
  assert.equal(doc.getElementById("foundedYear").value, "1997");
});

test("action=skip and null values do nothing", async () => {
  setup();
  assert.equal((await run(single, { value: "1997", action: "skip" })).status, "skipped");
  assert.equal((await run(single, { value: null, action: "addIfMissing" })).status, "skipped");
});

test("a field that is not on the page fails loudly instead of reporting success", async () => {
  setup();
  document.getElementById("foundedYear").remove();
  await assert.rejects(() => run(single, { value: "1997", action: "addIfMissing" }), /was not found on this page/);
});

test("record: clicks Add, fills text + dropdown on the new row, saves, verifies", async () => {
  const doc = setup();
  const result = await run(record, { title: "Best Co", level: "Gold", action: "addIfMissing" });
  assert.equal(result.status, "savedValueVerified");
  const rows = doc.querySelectorAll("#awards > div");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector("input").value, "Best Co");
  assert.equal(rows[0].querySelector("select").value, "G");
});

test("record: a second, different entry lands on its own new row; an identical one is skipped as a duplicate", async () => {
  const doc = setup();
  await run(record, { title: "Best Co", level: "Gold", action: "addIfMissing" });
  const second = await run(record, { title: "Runner Up", level: "Silver", action: "addIfMissing" });
  assert.equal(second.status, "savedValueVerified");
  assert.equal(doc.querySelectorAll("#awards > div").length, 2);
  const duplicate = await run(record, { title: "best co", level: "Gold", action: "addIfMissing" });
  assert.equal(duplicate.status, "skipped");
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(doc.querySelectorAll("#awards > div").length, 2);
});

test("a Save button that never returns to disabled is reported as failed, never as saved", async () => {
  setup({ saveDisables: false });
  await assert.rejects(() => run(single, { value: "1997", action: "addIfMissing" }), /Save did not complete/);
});

test("an unsupported dropdown value throws before touching the page", async () => {
  const doc = setup();
  await assert.rejects(() => run(select, { value: "Bronze", action: "addIfMissing" }), /not a supported value/);
  assert.equal(doc.getElementById("tier").value, "");
});
