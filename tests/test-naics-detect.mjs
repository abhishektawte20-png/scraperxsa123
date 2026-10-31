// One-click mapping of the NAICS dialog: starting from the Add NAICS button, every other part is found
// by itself, and the mapping it builds publishes a code. Run against the replica of RTS's dialog.

import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, t } from "./helpers/naics-dialog.mjs";

const defFrom = (found, opener) => ({
  key: "companyNaicsCodes", label: "NAICS codes", description: "", kind: "record",
  fields: [{ key: "code", kind: "tree", selectors: [] }],
  openButton: { selectors: opener.selectors, text: opener.text }, saveButton: { selectors: found.save.selectors, text: found.save.text },
  tree: { kind: "naics", expander: { selectors: found.expander.selectors }, leaf: { selectors: found.leaf.selectors }, sectionSave: { selectors: found.sectionSave.selectors, text: found.sectionSave.text } },
  binds: { path: "company.naicsCodes", map: { code: "code" } }
});

for (const [name, options] of [["plain", {}], ["radio inputs hidden, only their drawing is shown", { hiddenInputs: true }], ["a tree that redraws every element after each click", { preserve: false }]]) {
  test(`one click finds every part and the mapping it builds publishes a code (${name})`, async () => {
    const { doc, state, dlg } = setup(options);
    const openerEl = doc.getElementById("addNaics");
    const found = await t.detect(openerEl);

    assert.ok(found.expander.selectors.length && found.leaf.selectors.length, "a + button and a radio button were found");
    assert.equal(found.save.text, "Save", "the dialog's own Save");
    assert.equal(found.sectionSave.text, "Save Changes");
    assert.equal(found.closed, true, "the dialog was closed again");
    assert.equal(dlg.style.display, "none");
    assert.equal(state.saves, 0, "nothing was saved while detecting");
    assert.equal(state.sectionSaves, 0);
    assert.deepEqual(state.listed, []);
    // It is the NAICS section's Save Changes, not the look-alike GECS one.
    const sb = globalThis.SXRTS.selectorBuilder;
    const sectionButton = sb.resolveButtonByDefinition(found.sectionSave);
    assert.equal(sectionButton?.closest("#naics")?.id, "naics");

    const opener = globalThis.SXRTS.selectorBuilder.inspectButton(openerEl, {});
    const result = await globalThis.SXRTS.workflows.customField.applyCustomField(defFrom(found, opener), { action: "addIfMissing", code: "541511" });
    assert.equal(result.status, "savedValueVerified");
    assert.deepEqual(state.listed, ["541511"]);
    assert.equal(state.gecsSaves, 0);
  });
}

test("a dialog that is already open is used as it is", async () => {
  const { doc, state } = setup();
  doc.getElementById("addNaics").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const opensBefore = state.opens;
  const found = await t.detect(doc.getElementById("addNaics"));
  assert.equal(state.opens, opensBefore, "the button was not pressed again");
  assert.ok(found.leaf.selectors.length);
});

test("a greyed-out Add button is a clear error", async () => {
  const { doc } = setup();
  const button = doc.getElementById("addNaics");
  button.setAttribute("aria-disabled", "true");
  await assert.rejects(t.detect(button), /greyed out/);
});

test("a look-alike tick box elsewhere on the page is never clicked while detecting", async () => {
  const { doc } = setup();
  const decoy = doc.createElement("input");
  decoy.type = "checkbox";
  decoy.name = "tree-expander";
  decoy.setAttribute("aria-label", "Expand something else");
  doc.body.insertBefore(decoy, doc.body.firstChild);
  let clicks = 0;
  decoy.addEventListener("click", () => { clicks++; });
  const found = await t.detect(doc.getElementById("addNaics"));
  assert.equal(clicks, 0);
  assert.equal(decoy.checked, false);
  assert.ok(found.leaf.selectors.length && found.sectionSave);
});
