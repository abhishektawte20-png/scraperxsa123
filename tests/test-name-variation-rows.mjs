// New-row identification for Name Variations. RTS may insert the new row
// anywhere and may re-render the existing rows; the workflow must never type
// into (and then save over) an existing variation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-name-variations.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/index.js";
import "../core/workflows/businessEntityNameVariations.js";

const ROW = `
  <input type="text" value="" data-defaultvalue="" class="input businessEntityName">
  <select class="input input_select businessEntityNameType">
    <option value="FAMILIAR">Familiar Name</option>
    <option value="FORMER">Former Name</option>
    <option value="LEGAL">Legal Name</option>
    <option value="OTHER" selected="selected">Other Name</option>
    <option value="NATIVE_OTHER">Native Other Name</option>
  </select>`;

const rows = () => Array.from(document.querySelectorAll(".businessEntityName:not(.businessEntityNameMain)"));

// mode: where the new row goes ("bottom" | "top") and whether existing rows are re-rendered.
function setup({ position = "bottom", rerender = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${fixtureHtml}</body></html>`, { runScripts: "outside-only" });
  const { window } = dom;
  Object.assign(global, {
    window, document: window.document, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const state = { saves: 0 };

  document.getElementById("addNameVariation").addEventListener("click", () => {
    if (rerender) {
      for (const node of document.querySelectorAll(".businessEntityName:not(.businessEntityNameMain), .businessEntityNameType")) node.replaceWith(node.cloneNode(true));
    }
    const row = document.createElement("div");
    row.innerHTML = ROW;
    if (position === "top") {
      const first = rows()[0] ?? document.getElementById("addNameVariation");
      (first.closest("div") && first !== document.getElementById("addNameVariation") ? first : first).insertAdjacentElement("beforebegin", row);
    } else {
      document.getElementById("addNameVariation").insertAdjacentElement("beforebegin", row);
    }
  });

  document.getElementById("saveBusinessEntityNameVariation").addEventListener("click", () => {
    state.saves += 1;
    setTimeout(() => {
      // The row that was edited is the one whose value differs from its saved default.
      const dirty = rows().find((input) => input.value !== (input.dataset.defaultvalue ?? ""));
      if (dirty) {
        dirty.dataset.defaultvalue = dirty.value;
        dirty.classList.add("savedNameVariation");
      }
    }, 30);
  });
  return state;
}

const apply = (candidate) => globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation(candidate);
const values = () => rows().map((r) => r.value);

test("control: new row appended at the bottom is filled and verified", async () => {
  setup();
  const before = values();
  assert.equal((await apply({ name: "Appended Co", type: "Other Name" })).status, "savedValueVerified");
  assert.deepEqual(values(), [...before, "Appended Co"]);
});

test("a new row inserted at the TOP is the one that gets written; existing rows are untouched", async () => {
  setup({ position: "top" });
  const before = values();
  assert.equal((await apply({ name: "Top Co", type: "Other Name" })).status, "savedValueVerified");
  assert.deepEqual(values(), ["Top Co", ...before]);
});

test("existing rows re-rendered by the page, new row at the bottom: still correct", async () => {
  setup({ rerender: true });
  const before = values();
  assert.equal((await apply({ name: "Rerender Co", type: "Other Name" })).status, "savedValueVerified");
  assert.deepEqual(values(), [...before, "Rerender Co"]);
});

test("existing rows re-rendered AND new row at the top: refuses to guess, types nothing, never clicks Save", async () => {
  const state = setup({ position: "top", rerender: true });
  const before = values();
  await assert.rejects(() => apply({ name: "Unsafe Co", type: "Other Name" }), /nothing was typed/);
  // The page itself added a blank row on Add; every existing value is intact and nothing was typed.
  assert.deepEqual(values().filter(Boolean), before);
  assert.ok(!values().includes("Unsafe Co"));
  assert.equal(state.saves, 0);
});
