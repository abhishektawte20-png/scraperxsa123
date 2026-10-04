// Mapping the NAICS tree dialog through the real wizard: pick the Add NAICS
// button, then a +, a radio and the dialog's Save inside the dialog, then the
// section's Save Changes; try a code; save; and publish with the stored mapping.

import assert from "node:assert/strict";
import { test } from "node:test";

import "../core/outputFields.js";
import "../content/ui.js";
import "../content/teach.js";
import { setup } from "./helpers/naics-dialog.mjs";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return true; await tick(20); }
  return false;
}

const buttonByText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

function mountWizard() {
  const page = setup();
  const store = new Map();
  global.chrome = { storage: { local: { async get(k) { return store.has(k) ? { [k]: store.get(k) } : {}; }, async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); }, async remove(k) { store.delete(k); } } } };
  const { doc } = page;
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  let mapped = null;
  const teach = globalThis.SXRTS.teach.mount(shadow, { onMapped: (label) => { mapped = label; } });
  teach.open({ bindPath: "company.naicsCodes", samples: [{ code: "541511" }] });
  const pick = async (target) => {
    // The extension may open branches first; the picker overlay appears after that.
    await until(() => shadow.querySelector(".teach-overlay"));
    doc.elementFromPoint = () => (typeof target === "function" ? target() : target);
    shadow.querySelector(".teach-overlay").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await tick(30);
  };
  return { ...page, shadow, pick, card: shadow.querySelector(".teach-card"), mapped: () => mapped };
}

test("maps the NAICS dialog step by step, tries a code, saves, and the stored mapping publishes", async () => {
  const { doc, shadow, pick, card, state, dlg, mapped } = mountWizard();
  assert.match(card.querySelector("h2").textContent, /Map "NAICS codes" to RTS/);
  assert.match(card.textContent, /Step A · The Add NAICS button/);

  // The gap between the buttons is not the button: refused with a plain reason.
  buttonByText(card, "Pick the Add NAICS button").click();
  await pick(doc.querySelector("#naics .group__i"));
  assert.match(card.textContent, /not the button itself/);

  // The caption inside the button is fine; the extension then opens the dialog.
  buttonByText(card, "Pick the Add NAICS button").click();
  await pick(doc.querySelector("#addNaics .button__caption"));
  assert.equal(dlg.style.display, "block", "the dialog was opened for the researcher");
  assert.equal(state.opens, 1);

  // Inside the dialog: a +, then (after opening a branch) a radio, then Save.
  buttonByText(card, "Pick a + button").click();
  assert.ok(Array.from(shadow.querySelectorAll(".teach-bar button")).some((b) => b.textContent === "Open the dialog"), "the pick bar can reopen the dialog");
  await pick(doc.querySelector("input[name=tree-expander]"));
  assert.match(card.textContent, /Step B/);

  buttonByText(card, "Open a branch and pick a radio button").click();
  await pick(() => doc.querySelector(".radio-button__pointer svg"));
  buttonByText(card, "Pick the dialog's Save button").click();
  await pick(doc.querySelector("#dlgSave"));

  // The section's Save Changes: the other section's button is refused.
  doc.getElementById("dlgCancel").click();
  buttonByText(card, "Pick Save Changes").click();
  await pick(doc.querySelector("#gecsSave"));
  assert.match(card.textContent, /not in the same section as the Add NAICS button/);
  buttonByText(card, "Pick Save Changes").click();
  await pick(doc.querySelector("#naicsSave"));
  assert.equal(card.querySelectorAll(".teach-guide li.done").length, 3, "steps 2, 3 and 4 are ticked");

  // Try it: finds the code and selects it, but saves nothing.
  const tryBox = Array.from(card.querySelectorAll("input[type=text]")).find((i) => i.value === "541511");
  assert.ok(tryBox, "a code to try is pre-filled");
  buttonByText(card, "Find this code in the dialog").click();
  assert.ok(await until(() => /Found 541511 and selected it/.test(card.textContent)), card.textContent.slice(-400));
  assert.equal(doc.querySelector("input[type=radio]:checked").closest("label").textContent.trim().startsWith("541511"), true);
  assert.equal(state.saves, 0, "nothing was saved by the dry run");
  doc.getElementById("dlgCancel").click();

  buttonByText(card, "Save mapping").click();
  await tick(50);
  const def = globalThis.SXRTS.customFields.getBoundDef("company.naicsCodes");
  assert.ok(def, "the mapping is stored");
  assert.equal(def.kind, "record");
  assert.equal(def.fields[0].kind, "tree");
  assert.ok(def.openButton.selectors.includes('[data-test-id="naics-add-button"]'));
  assert.ok(def.saveButton.selectors.includes('[data-test-id="naics-modal-save-button"]'));
  assert.ok(def.tree.sectionSave.selectors.includes('[data-test-id="naics-save-button"]'));
  assert.equal(def.openButton.text, "Add NAICS");
  for (const selectors of [def.tree.expander.selectors, def.tree.leaf.selectors]) {
    assert.ok(selectors.every((s) => !s.startsWith("#") && !/aria-label/.test(s)), `shared selectors only: ${selectors}`);
  }
  assert.equal(mapped(), "NAICS codes");

  // The stored mapping now publishes a code the researcher never opened.
  const result = await globalThis.SXRTS.workflows.customField.applyCustomField(def, { action: "addIfMissing", code: "541512" });
  assert.equal(result.status, "savedValueVerified");
  assert.deepEqual(state.listed, ["541512"]);
  assert.equal(state.gecsSaves, 0);
});

test("Save mapping is refused until every part is picked", async () => {
  const { card } = mountWizard();
  buttonByText(card, "Save mapping").click();
  await tick();
  assert.match(card.textContent, /Pick all the parts above first/);
});
