// A field inside a section RTS shows closed is found by opening that one section (its own arrow), nothing else is opened.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import "../core/identityLock.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/navigation.js";
import "../core/workflows/businessEntityGeneral.js";

function page() {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="container" id="container_GNRL"><div class="containerHeading"><span class="collapseSection" id="a1"></span></div><div class="container-body-holder" style="display:none"><input id="webURL" type="text"><button id="saveBusinessEntityButton" disabled>Save</button></div></div>
    <div class="container" id="container_OTHER"><div class="containerHeading"><span class="collapseSection" id="a2"></span></div><div class="container-body-holder" style="display:none"><p>other</p></div></div>
  </body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  Object.assign(global, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, InputEvent: window.InputEvent });
  window.HTMLElement.prototype.checkVisibility = function () { for (let n = this; n; n = n.parentElement) if (n.style?.display === "none") return false; return true; };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const clicks = [];
  for (const id of ["a1", "a2"]) document.getElementById(id).addEventListener("click", (e) => { clicks.push(id); e.target.closest(".container").querySelector(".container-body-holder").style.display = ""; });
  const save = document.getElementById("saveBusinessEntityButton");
  document.getElementById("webURL").addEventListener("input", () => { save.disabled = false; });
  save.addEventListener("click", () => setTimeout(() => { save.disabled = true; }, 20));
  return clicks;
}

test("the Website box inside a closed section: only that section is opened, then the website is written", async () => {
  const clicks = page();
  const result = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({ websiteAddresses: [{ value: "https://a.com", action: "addIfMissing" }] });
  assert.equal(result.status, "savedValueVerified", JSON.stringify(result));
  assert.deepEqual(clicks, ["a1"], "the other closed section was left closed");
  assert.equal(document.getElementById("webURL").value, "https://a.com");
});

test("a field that is already on screen opens nothing", async () => {
  const clicks = page();
  document.querySelector("#container_GNRL .container-body-holder").style.display = "";
  await globalThis.SXRTS.navigation.openClosedSections(() => document.getElementById("webURL"));
  assert.deepEqual(clicks, []);
});

test("one field that cannot be found does not stop the others", async () => {
  page();
  document.querySelector("#container_GNRL .container-body-holder").style.display = "";
  const result = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral({ websiteAddresses: [{ value: "https://a.com", action: "addIfMissing" }], financingStatus: { value: "Corporation", action: "replaceAfterConfirmation" } });
  assert.match(result.results.financingStatus.reason, /Financing Status dropdown was not found/);
  assert.equal(result.results.websiteAddresses.status, "savedValueVerified");
});
