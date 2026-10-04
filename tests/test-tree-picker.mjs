// The "Select NAICS" tree dialog, replicated in jsdom (see helpers/naics-dialog.mjs).

import assert from "node:assert/strict";
import { test } from "node:test";

import { setup } from "./helpers/naics-dialog.mjs";

const def = {
  key: "companyNaicsCodes", label: "NAICS codes", description: "", kind: "record",
  fields: [{ key: "code", kind: "tree", selectors: [] }],
  openButton: { selectors: ['[data-test-id="naics-add-button"]'], text: "Add NAICS" },
  saveButton: { selectors: ['[data-test-id="naics-modal-save-button"]'], text: "Save" },
  tree: { kind: "naics", expander: { selectors: ['input[name="tree-expander"]'] }, leaf: { selectors: ["input.radio-button__handler"] }, sectionSave: { selectors: ['[data-test-id="naics-save-button"]'], text: "Save Changes" } },
  binds: { path: "company.naicsCodes", map: { code: "code" } }
};
const run = (record, definition = def) => globalThis.SXRTS.workflows.customField.applyCustomField(definition, { action: "addIfMissing", ...record });
// Selectors that are shared by every section's buttons, so only the text and the position tell them apart.
const generic = { ...def, openButton: { selectors: ["button.button"], text: "Add NAICS" }, tree: { ...def.tree, sectionSave: { selectors: ["button.button_primary"], text: "Save Changes" } } };

test("opens the dialog, finds the code, chooses it, saves the dialog, then saves the section, and reads the code back", async () => {
  const { state, dlg } = setup();
  const result = await run({ code: "541511" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541511"]);
  assert.equal(state.opens, 1);
  assert.equal(state.saves, 1);
  assert.equal(state.sectionSaves, 1, "the NAICS section's Save Changes was clicked once");
  assert.equal(state.gecsSaves, 0, "the look-alike GECS Save Changes button was left alone");
  assert.equal(dlg.style.display, "none");
});

test("a code deep in Manufacturing is found by searching, not by opening every sub-sector", async () => {
  const { state, doc } = setup();
  const result = await run({ code: "334110" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual(state.listed, ["334110"]);
  assert.ok(state.expanderClicks < 90, `${state.expanderClicks} expander clicks`);
  const openSubs = Array.from(doc.querySelectorAll("input[name=tree-expander]")).filter((e) => e.checked && /Subsector/.test(e.getAttribute("aria-label"))).length;
  assert.ok(openSubs <= 6, `${openSubs} sub-sectors opened out of 21`);
});

test("the same works when the buttons' selectors are shared by every section (only their text and position tell them apart)", async () => {
  const { state } = setup();
  const result = await run({ code: "541511" }, generic);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(state.gecsSaves, 0);
  assert.deepEqual(state.listed, ["541511"]);
});

test("the list of codes may sit above the Add / Save Changes row, outside it", async () => {
  const { doc, state } = setup({ preList: ["541512"] });
  assert.ok(!doc.querySelector(".group").textContent.includes("541512"), "the codes are not inside the buttons' row");
  const dup = await run({ code: "541512" });
  assert.equal(dup.reason, "duplicate");
  assert.equal(state.opens, 0);
});

test("works when the tree re-renders every element after each click", async () => {
  const { state } = setup({ preserve: false });
  const result = await run({ code: "541512" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541512"]);
});

test("works when the radio inputs are hidden and only their label is drawn", async () => {
  const { state } = setup({ hiddenInputs: true });
  assert.equal((await run({ code: "111110" })).status, "savedValueVerified");
  assert.deepEqual(state.listed, ["111110"]);
});

test("a sector whose name RTS spells differently is found by its position", async () => {
  const { state } = setup({ renameSector: true });
  assert.equal((await run({ code: "541511" })).status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541511"]);
});

test("a dialog left open with branches already expanded is reset and used", async () => {
  const { state, dlg } = setup({ startExpanded: true });
  dlg.style.display = "block";
  assert.equal((await run({ code: "541511" })).status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541511"]);
  assert.equal(state.opens, 0, "it did not click Add NAICS because the dialog was already open");
});

test("a code the section already lists is skipped and the dialog is never opened", async () => {
  const { state } = setup({ preList: ["541511"] });
  const result = await run({ code: "541511" });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "duplicate");
  assert.equal(state.opens, 0);
});

test("accepts a code with its title, and rejects what is not a 6-digit code", async () => {
  const { state } = setup();
  assert.equal((await run({ code: "541511 – Custom Computer Programming Services" })).status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541511"]);
  await assert.rejects(() => run({ code: "5415" }), /not a 6-digit NAICS code/);
  assert.equal((await run({ code: "" })).status, "skipped");
});

test("a code that is not in RTS's list is an error, and nothing is saved", async () => {
  const { state } = setup();
  await assert.rejects(() => run({ code: "541999" }), /541999 is not in RTS's list/);
  assert.equal(state.saves, 0);
  await assert.rejects(() => run({ code: "991234" }), /does not start with a NAICS sector number/);
});

test("it stops with a clear message if the dialog stays open after Save, or Save Changes never wakes up or never settles", async () => {
  setup({ dialogClosesOnSave: false });
  await assert.rejects(() => run({ code: "541511" }), /dialog stayed open after Save/);
  setup({ sectionSaveEnables: false });
  await assert.rejects(() => run({ code: "541511" }), /Save Changes did not become active/);
  setup({ sectionSaveSettles: false });
  await assert.rejects(() => run({ code: "541511" }), /never went back to inactive/);
  setup({ saveEnabledByRadio: false });
  await assert.rejects(() => run({ code: "541511" }), /Save button stayed disabled/);
});

test("if the section does not list the code afterwards, it is reported as saved by state only, never as read back", async () => {
  setup({ listShowsCode: false });
  const result = await run({ code: "541511" });
  assert.equal(result.status, "savedStateVerified");
  assert.match(result.detail, /could not be read back/);
});

test("a missing Add button or Save Changes button is a clear error", async () => {
  const { doc } = setup();
  doc.getElementById("addNaics").remove();
  await assert.rejects(() => run({ code: "541511" }), /"Add NAICS" button was not found/);
});

test("tree definitions validate: needs the opener, expander, choice and section Save selectors", () => {
  const cf = globalThis.SXRTS.customFields;
  globalThis.SXRTS.outputFields = globalThis.SXRTS.outputFields ?? { get: () => ({ label: "NAICS", kind: "list", keys: [{ key: "code" }] }) };
  assert.deepEqual(cf.validateDefinition(def), []);
  assert.ok(cf.validateDefinition({ ...def, tree: { ...def.tree, expander: { selectors: [] } } }).some((e) => /expand/.test(e)));
  assert.ok(cf.validateDefinition({ ...def, tree: { ...def.tree, sectionSave: undefined } }).some((e) => /Save Changes/.test(e)));
  assert.ok(cf.validateDefinition({ ...def, openButton: undefined }).some((e) => /needs the button that opens/.test(e)));
});
