// DOM-level tests for the Business Entity "General" shared-save-group
// workflow (Website Address, Email Default Structure, Research Notes),
// run against a jsdom reconstruction of the evidenced markup. The Save
// button's dirty-tracking and post-save disabled state are SIMULATED
// here to match the confirmed real behavior (the researcher verified
// the button returns to disabled after a successful save).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-general.html"), "utf8");

import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/workflows/businessEntityGeneral.js";

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

const { businessEntityGeneral } = globalThis.SXRTS.workflows;

test("writes Website Address when currently blank, then saves the group", async () => {
  setupDom();
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.results.websiteAddresses.status, "savedValueVerified");
  assert.equal(document.getElementById("webURL").value, "www.dmcspain.com");
});

test("skips Website Address when it already has a value, unless replaceAfterConfirmation", async () => {
  setupDom();
  document.getElementById("webURL").value = "www.existing.com";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.new.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "skipped");
  assert.equal(document.getElementById("webURL").value, "www.existing.com");

  const replaced = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.new.com", action: "replaceAfterConfirmation" }]
  });
  assert.equal(replaced.status, "savedValueVerified");
  assert.equal(document.getElementById("webURL").value, "www.new.com");
});

test("selects Email Default Structure by label or by code, only when currently blank", async () => {
  setupDom();
  const select = document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]');
  select.value = "-1"; // simulate a profile with no structure set yet
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    emailDefaultStructure: { value: "2", action: "addIfMissing" }
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(select.value, "2");
});

test("rejects an Email Default Structure value outside the evidenced catalog", async () => {
  setupDom();
  document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').value = "-1";
  await assert.rejects(
    () => businessEntityGeneral.applyBusinessEntityGeneral({ emailDefaultStructure: { value: "Not.A.Real@pattern.com", action: "addIfMissing" } }),
    /not a supported Email Default Structure value/
  );
});

test("appends a research note only if not already present, and saves", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.textContent = "Existing note about the business.";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    researchNotes: [
      { text: "Existing note about the business.", action: "addIfMissing" }, // already present, should not duplicate
      { text: "Bootstrapped, no external funding identified.", action: "addIfMissing" }
    ]
  });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(globalThis.SXRTS.adapters.contentEditable.readContentEditable(editable), "Existing note about the business.\n\nBootstrapped, no external funding identified.");
});

test("research notes are added AFTER the existing act log, which keeps its links and line breaks exactly as they were", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  const original = '06/12/26, Aimee.Richardson: Please research per NBC NC process ///<br>7/22/26 somnath.payra:<br>1 <a title="Ctrl+Click to follow link" class="highlight-textarea__link" href="https://lungenarzt.com/">https://lungenarzt.com/</a><br>2 Following the takeover ///<br><br>10/30/26 Sampada.Mowade: IWF for M&amp;A, proceed normally. ///';
  editable.innerHTML = original;
  const note = "11/12/26 Abhishek.Tawte: Completed New Co Research. Added general from links (1-4), site from link (3,4), management from link (NA), rounds from links(NA), financials from links (NA)\n\n1. https://capafair.com/company\n\n\nAGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research\n///";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: note, action: "addIfMissing" }] });
  assert.equal(result.status, "savedValueVerified");
  assert.ok(editable.innerHTML.startsWith(original), "the existing HTML (link, <br>, entities) is untouched and first");
  assert.equal(editable.querySelectorAll("a.highlight-textarea__link").length, 1);
  const text = globalThis.SXRTS.adapters.contentEditable.readContentEditable(editable);
  assert.ok(text.startsWith("06/12/26, Aimee.Richardson: Please research per NBC NC process ///\n7/22/26 somnath.payra:\n1 https://lungenarzt.com/\n2 Following the takeover ///\n\n10/30/26 Sampada.Mowade: IWF for M&A, proceed normally. ///\n\n11/12/26 Abhishek.Tawte: Completed New Co Research."), text);
  assert.ok(text.endsWith("AGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research\n///"));
});

test("an act log that already carries AIGEN_SRX_V1_Y is not added to again", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.innerHTML = "10/30/26 Someone: done ///<br><br>AGENTS: AIGEN_SRX_V1_Y<br>///";
  const before = editable.innerHTML;
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: "11/12/26 X.Y: Completed New Co Research.\n\n\nAGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research\n///", action: "addIfMissing" }] });
  assert.equal(result.status, "skipped");
  assert.match(result.results.researchNotes.reason, /already has the act log mark/);
  assert.equal(editable.innerHTML, before);
});

test("the reader turns <br> and block boundaries into line breaks, and links into their text", () => {
  setupDom();
  const el = document.createElement("div");
  el.innerHTML = 'a<br>b <a href="#">link</a><div>c</div>d';
  assert.equal(globalThis.SXRTS.adapters.contentEditable.readContentEditable(el), "a\nb link\nc\nd");
});

test("replaceAfterConfirmation overwrites existing research notes", async () => {
  setupDom();
  const editable = document.querySelector(".highlight-textarea");
  editable.textContent = "Old note.";
  await businessEntityGeneral.applyBusinessEntityGeneral({
    researchNotes: [{ text: "Fully replaced note.", action: "replaceAfterConfirmation" }]
  });
  assert.equal(editable.textContent, "Fully replaced note.");
});

test("applies all three fields together with exactly one Save click", async () => {
  setupDom();
  document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').value = "-1"; // start blank, like Website Address
  const saveButton = document.getElementById("saveBusinessEntityButton");
  let clicks = 0;
  saveButton.addEventListener("click", () => { clicks += 1; });

  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }],
    emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing" },
    researchNotes: [{ text: "New note.", action: "addIfMissing" }]
  });

  assert.equal(clicks, 1);
  assert.equal(result.status, "savedValueVerified");
  assert.equal(result.results.websiteAddresses.status, "savedValueVerified");
  assert.equal(result.results.emailDefaultStructure.status, "savedValueVerified");
  assert.equal(result.results.researchNotes.status, "savedValueVerified");
});

test("reports failure (never false success) when the Save button never returns to disabled", async () => {
  setupDom();
  const saveButton = document.getElementById("saveBusinessEntityButton");
  const clone = saveButton.cloneNode(true); // drop the simulated post-save disable
  clone.disabled = false; // simulate a pending change that was registered, but the save hangs
  saveButton.replaceWith(clone);
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.dmcspain.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "failed");
  assert.match(result.results.websiteAddresses.reason, /never returned to a disabled/);
});

test("skips the whole group with nothing to save when every field is already populated", async () => {
  setupDom();
  document.getElementById("webURL").value = "www.already-set.com";
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({
    websiteAddresses: [{ value: "www.other.com", action: "addIfMissing" }]
  });
  assert.equal(result.status, "skipped");
});

test("with a Financing Status Note box above it, the act log goes into the box headed Research Notes, never the first box on the page", async () => {
  setupDom();
  const first = document.querySelector(".highlight-textarea");
  first.remove();
  document.body.insertAdjacentHTML("beforeend", '<div class="row"><span>Financing Status Note:</span><div contenteditable="" class="highlight-textarea" id="fin">Financing note stays.</div></div><div class="row"><span>Research Notes (Internal)</span><div contenteditable="" class="highlight-textarea" id="rn">old act log ///</div></div>');
  for (const id of ["fin", "rn"]) document.getElementById(id).addEventListener("input", () => { document.getElementById("saveBusinessEntityButton").disabled = false; });
  const result = await businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: "11/12/26 A.B: Completed New Co Research.\n\n\nAGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research\n///", action: "addIfMissing" }] });
  assert.equal(result.status, "savedValueVerified");
  assert.equal(document.getElementById("fin").textContent, "Financing note stays.", "the Financing Status Note is untouched");
  assert.match(document.getElementById("rn").textContent, /^old act log \/\/\/.*AGENTS: AIGEN_SRX_V1_Y/s);
});

test("several note boxes and no 'Research Notes' heading: nothing is written and the error says why", async () => {
  setupDom();
  document.querySelector(".highlight-textarea").remove();
  document.body.insertAdjacentHTML("beforeend", '<span>Some note</span><div contenteditable="" class="highlight-textarea" id="a"></div><span>Other note</span><div contenteditable="" class="highlight-textarea" id="b"></div>');
  await assert.rejects(businessEntityGeneral.applyBusinessEntityGeneral({ researchNotes: [{ text: "x", action: "addIfMissing" }] }), /could not be told apart, so nothing was written/);
  assert.equal(document.getElementById("a").textContent + document.getElementById("b").textContent, "");
});
