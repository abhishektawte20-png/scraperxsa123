// Smoke test for content/panel.js: mounts the real panel into a bare
// jsdom page (no RTS markup at all) and exercises the parts that don't
// require a live RTS DOM — validation, preview rendering, cache writes,
// and that Publish correctly blocks via the identity lock when no RTS
// identity can be read. This does NOT exercise the DOM-mutating
// workflows themselves (those have their own dedicated fixture tests).

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../core/adapters/textField.js";
import "../core/adapters/nativeSelect.js";
import "../core/adapters/contentEditable.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/agentSpec.js";
import "../core/promptBuilder.js";
import "../core/outputFields.js";
import "../core/executionPlan.js";
import "../core/workflows/businessEntityNameVariations.js";
import "../core/workflows/statusHistory.js";
import { statusControlsHtml, wireStatusControls } from "./helpers/status-controls.mjs";
import "../core/workflows/businessEntityGeneral.js";
import "../core/workflows/companySic.js";
import "../core/resultsSummary.js";
import "../content/ui.js";
import "../core/runControl.js";
import "../core/navigation.js";
import "../core/customFields.js";
import "../content/panel.js";
import "./helpers/researcher.mjs";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.HTMLInputElement = window.HTMLInputElement;
  global.HTMLTextAreaElement = window.HTMLTextAreaElement;
  global.HTMLSelectElement = window.HTMLSelectElement;
  global.Event = window.Event;
  global.InputEvent = window.InputEvent;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confirm = () => true;
  const store = new Map();
  global.chrome = {
    storage: {
      local: {
        async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        async remove(key) { store.delete(key); }
      }
    }
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  globalThis.SXRTS.panel.mount(shadow);
  return { dom, shadow };
}

// Publishing now does more steps (statuses, history tables), so wait for the summary instead of a fixed pause.
async function untilSummary(shadow, ms = 6000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const statuses = shadow.querySelectorAll(".status");
    if (/Saved \d+ · Already in RTS/.test(statuses[statuses.length - 1]?.textContent || "")) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function textOf(shadow, selector) {
  return shadow.querySelector(selector)?.textContent ?? "";
}

test("mounts without throwing and shows the ScraperX brand", () => {
  const { shadow } = setupDom();
  assert.match(textOf(shadow, ".brand-text h1"), /ScraperX/);
  assert.ok(shadow.querySelector("#sxrts-response"));
});

test("validating a valid response builds a preview with the expected row count", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: {
      nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }],
      websiteAddresses: [{ value: "www.psypher.in", action: "addIfMissing" }]
    }
  });
  responseArea.dispatchEvent(new window.Event("input", { bubbles: true }));

  const validateButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON");
  validateButton.click();

  const rows = shadow.querySelectorAll(".action-card");
  assert.equal(rows.length, 8, "the two fields, the ANC mark, the three fixed drop-downs, the business status row and the ownership row (skipped: no start date)");
  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save");
  assert.equal(publishButton.disabled, false);
});

test("a record's proposed value renders as labeled, individually editable fields (not a raw JSON blob)", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const labels = Array.from(card.querySelectorAll(".value-field-label")).map((el) => el.textContent);
  assert.ok(labels.includes("name"));
  assert.ok(labels.includes("type"));

  const nameField = Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === "name");
  const nameInput = nameField.querySelector("input, textarea");
  assert.equal(nameInput.value, "Psypher Inc");
  nameInput.value = "Psypher Incorporated"; // simulate a manual correction
  assert.equal(nameInput.value, "Psypher Incorporated"); // no JSON parsing involved, nothing to silently discard
});

test("rejects invalid JSON without building a preview", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = "{not valid json";
  const validateButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON");
  validateButton.click();
  const previewCard = Array.from(shadow.querySelectorAll(".card")).find((c) => c.textContent.includes("Preview, edit"));
  assert.ok(previewCard.classList.contains("hidden"));
});

test("publish blocks via the identity lock when no RTS page is present", async () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save");
  publishButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const statuses = shadow.querySelectorAll(".status");
  const publishStatus = statuses[statuses.length - 1];
  assert.match(publishStatus.textContent, /Blocked:/);
});

// Regression coverage for a real reported case: an existing RTS profile
// with a visible PBID but a blank Domain field. Rovo's JSON always has
// pbId/entityId as null (it has no way to know an RTS-internal ID), so
// domain is the only field that could ever match — and here it can't,
// even though the profile is legitimate. This must no longer be a hard
// block; it should ask the researcher to manually confirm instead.
function addIdentityWithNoStrongMatch() {
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: 862926-85</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
    <input type="text" value="" id="domainValue">
  `);
}

test("insufficient identity (no strong match, but no conflict either) asks for manual confirmation instead of blocking", async () => {
  const { shadow } = setupDom();
  addIdentityWithNoStrongMatch();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", domain: "aromagrowstore.com" },
    businessEntity: { nameVariations: [{ name: "Best Supply Partners LLC", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  let confirmCalls = 0;
  window.confirm = () => { confirmCalls += 1; return confirmCalls === 1; }; // accept the generic publish confirm, decline the identity one

  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /could not be auto-confirmed, and you chose not to proceed manually/);
  assert.equal(confirmCalls, 2, "both the generic publish confirm and the identity confirm should have been asked");
});

test("insufficient identity proceeds to publish once manually confirmed", async () => {
  const { shadow } = setupDom();
  addIdentityWithNoStrongMatch();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="name-variation-row">
      <input type="text" value="" data-defaultvalue="" class="input businessEntityName" data-disabled-if-dnb-field="">
      <select class="input input_select businessEntityNameType" data-disabled-if-dnb-field="">
        <option value="LEGAL" selected="selected">Legal Name</option>
      </select>
    </div>
    <input type="button" value="Add New Name Variation" class="btn" id="addNameVariation">
    <input type="button" value="Save" id="saveBusinessEntityNameVariation">
    <div class="highlight-textarea" contenteditable=""></div>
    <input type="button" id="saveBusinessEntityButton">
    ${statusControlsHtml()}
  `);
  wireStatusControls(document);
  document.getElementById("saveBusinessEntityButton").addEventListener("click", () => { setTimeout(() => { document.getElementById("saveBusinessEntityButton").disabled = true; }, 10); });
  const nameInputs = () => document.querySelectorAll(".businessEntityName");
  document.getElementById("addNameVariation").addEventListener("click", () => {
    const row = document.createElement("div");
    row.innerHTML = `<input type="text" value="" data-defaultvalue="" class="input businessEntityName"><select class="input input_select businessEntityNameType"><option value="LEGAL" selected="selected">Legal Name</option></select>`;
    document.getElementById("addNameVariation").insertAdjacentElement("beforebegin", row);
  });
  document.getElementById("saveBusinessEntityNameVariation").addEventListener("click", () => {
    setTimeout(() => {
      const last = [...nameInputs()].pop();
      last.dataset.defaultvalue = last.value;
      last.classList.add("savedNameVariation");
    }, 10);
  });

  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", domain: "aromagrowstore.com" },
    businessEntity: { nameVariations: [{ name: "Best Supply Partners LLC", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  window.confirm = () => true; // accept both the generic publish confirm and the identity confirm

  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save").click();
  await untilSummary(shadow);

  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /Saved 3 · Already in RTS 3 · Needs attention 0/);
});

test("clear cache button does not throw when no cache exists yet", async () => {
  const { shadow } = setupDom();
  const clearButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Clear cache for this profile");
  assert.doesNotThrow(() => clearButton.click());
});

test("the per-run prompt is only the domain, and no button can replace the Rovo agent's own methodology", () => {
  const { shadow } = setupDom();
  assert.equal(Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Copy agent setup instructions"), undefined);
  const domain = shadow.querySelector("#sxrts-domain");
  domain.value = "dmcspain.com";
  domain.dispatchEvent(new window.Event("input", { bubbles: true }));
  const prompt = shadow.querySelector("#sxrts-prompt").value;
  assert.equal(prompt.split("\n")[0], "dmcspain.com");
  assert.match(prompt, /Target domain: dmcspain\.com/);
  assert.match(prompt, /"target_domain": "dmcspain\.com"/);
  assert.match(prompt, /THE RESPONSE HAS EXACTLY 22 TOP-LEVEL KEYS/);
});

test("action and Name Type render as constrained dropdowns, not free-text inputs", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1" },
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing", confidence: "high" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const fieldByLabel = (label) => Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === label);

  const actionSelect = fieldByLabel("action").querySelector("select");
  assert.ok(actionSelect, "action should render as a <select>, not an <input>");
  assert.equal(actionSelect.value, "addIfMissing");

  const typeSelect = fieldByLabel("type").querySelector("select");
  assert.ok(typeSelect, "Name Type should render as a <select> populated from the evidenced catalog");
  assert.equal(typeSelect.value, "Legal Name");

  const confidenceSelect = fieldByLabel("confidence").querySelector("select");
  assert.ok(confidenceSelect, "confidence should render as a <select>");
  assert.equal(confidenceSelect.value, "high");
});

// Regression test for a real bug: core/executionPlan.js used to unwrap an
// envelope-kind field's proposedValue down to a bare scalar (e.g. just the
// email-pattern string), but applyEmailDefaultStructureValue() reads
// .action/.value off an object — so every real publish of this field
// either threw "'undefined' is not a supported Email Default Structure
// value" or silently no-op'd. This exercises the full panel -> execution
// plan -> workflow chain against a live (jsdom) RTS DOM to prove it now
// actually writes and saves the value.
test("publishing Email Default Structure actually writes and saves it end to end", async () => {
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: PB-1</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
    <input type="text" value="" id="domainValue">
    <input type="text" value="" id="webURL" name="businessEntity.webURL">
    <select name="businessEntity.emailDefaultStructure.id">
      <option value="-1" selected="selected"></option>
      <option value="2">FirstInitialLastName@domain.com</option>
    </select>
    <div class="highlight-textarea" contenteditable=""></div>
    <input type="button" disabled="disabled" id="saveBusinessEntityButton">
    ${statusControlsHtml()}
  `);
  wireStatusControls(document);
  const emailSelect = document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]');
  const saveButton = document.getElementById("saveBusinessEntityButton");
  emailSelect.addEventListener("input", () => { saveButton.disabled = false; });
  emailSelect.addEventListener("change", () => { saveButton.disabled = false; });
  saveButton.addEventListener("click", () => { setTimeout(() => { saveButton.disabled = true; }, 10); });

  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", pbId: "PB-1" },
    businessEntity: { emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing" } }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save");
  publishButton.click();
  await untilSummary(shadow);

  assert.equal(emailSelect.value, "2");
  const statuses = shadow.querySelectorAll(".status");
  assert.match(statuses[statuses.length - 1].textContent, /Saved 3 · Already in RTS 3 · Needs attention 0/, "the email, the ANC mark and the business status row saved; the three drop-downs already showed the wanted values");
  assert.match(globalThis.SXRTS.adapters.contentEditable.readContentEditable(document.querySelector(".highlight-textarea")), /Test\.Researcher: Completed New Co Research[\s\S]*AGENTS: AIGEN_SRX_V1_Y\nUsed ScraperX UI Automation Tool for Research/);
  const bar = shadow.querySelector(".pbar");
  assert.ok(!bar.classList.contains("hidden"), "the progress bar is shown after a publish");
  assert.ok(bar.classList.contains("done"), "and it is green when everything went through");
  assert.match(bar.querySelector(".pbar-label").textContent, /Done · all 6 fields processed/);
  assert.equal(bar.querySelector(".pbar-fill").style.width, "100%");
  assert.match(bar.querySelector(".pbar-note").textContent, /Took .* · saved 3/);
});

test("an invalid manual edit is caught by real schema re-validation before any workflow runs", async () => {
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("beforeend", `
    <span class="flat-button__caption flat-button__caption-abc123">PBID: PB-1</span>
    <input type="text" name="formalNameVariations" value="Aroma Grow Store" data-defaultvalue="Aroma Grow Store">
  `);
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Aroma Grow Store", pbId: "PB-1" },
    businessEntity: { nameVariations: [{ name: "Aroma Grow Store", type: "Legal Name", action: "addIfMissing" }] }
  });
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();

  const card = shadow.querySelector(".action-card");
  const nameField = Array.from(card.querySelectorAll(".value-field")).find((f) => f.querySelector(".value-field-label").textContent === "name");
  nameField.querySelector("input").value = "   "; // blanked out by mistake while correcting it

  const publishButton = Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save");
  publishButton.click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const reason = card.querySelector(".action-reason").textContent;
  assert.match(reason, /must be a non-empty string/);
  assert.ok(!/Add New Name Variation/.test(reason), "the workflow (and its live DOM lookup) must never run once re-validation rejects the edit");
});

test("the ANC mark row is ticked, marked required, and cannot be unticked or edited", () => {
  const { shadow } = setupDom();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" },
    businessEntity: { websiteAddresses: [{ value: "www.psypher.in", action: "addIfMissing" }] }
  });
  responseArea.dispatchEvent(new window.Event("input", { bubbles: true }));
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();
  const card = Array.from(shadow.querySelectorAll(".action-card")).find((c) => /researchNotes/.test(c.textContent));
  assert.ok(card, "the ANC row is there even though the report did not mention it");
  assert.match(card.textContent, /required/);
  const box = card.querySelector('input[type="checkbox"]');
  assert.equal(box.checked, true);
  box.click();
  assert.equal(box.checked, true, "clicking does not untick it");
  assert.ok(Array.from(card.querySelectorAll("input[type=text], textarea")).every((i) => i.disabled), "its text cannot be edited");
});

test("the progress bar is hidden before a publish and amber, with the count of problems, when a field needs attention", async () => {
  const { shadow } = setupDom();
  assert.ok(shadow.querySelector(".pbar").classList.contains("hidden"));
  addIdentityWithNoStrongMatch();
  const responseArea = shadow.querySelector("#sxrts-response");
  responseArea.value = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Best Supply Partners", domain: "bsp.com" },
    businessEntity: { emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing" } }
  });
  responseArea.dispatchEvent(new window.Event("input", { bubbles: true }));
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Validate JSON").click();
  window.confirm = () => true;
  Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === "Publish and save").click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const bar = shadow.querySelector(".pbar");
  assert.ok(bar.classList.contains("warn"), "nothing on this page can be saved, so the bar is amber");
  assert.match(bar.querySelector(".pbar-label").textContent, /Finished · 6 of 6 fields processed · 6 need attention/);
});


// ---- guardrails: nothing touches RTS until Publish, Pause stops everything, and the researcher is told what will happen ----

// Watches the RTS page (everything outside the panel) for clicks, typing, focus changes and any change to the page itself.
function watchPage(shadow) {
  const host = shadow.host;
  const seen = [];
  for (const type of ["click", "input", "change", "focus", "focusin", "keydown", "keyup", "submit", "mousedown"]) {
    document.addEventListener(type, (event) => { if (!event.composedPath().includes(host)) seen.push(`${type}:${event.target?.id || event.target?.tagName}`); }, true);
  }
  const observer = new window.MutationObserver((records) => { for (const r of records) if (!host.contains(r.target) && r.target !== host) seen.push(`mutation:${r.type}:${r.target.id || r.target.nodeName}`); });
  observer.observe(document.body, { childList: true, attributes: true, characterData: true, subtree: true });
  return { seen, flush: () => { for (const r of observer.takeRecords()) if (!host.contains(r.target) && r.target !== host) seen.push(`mutation:${r.type}:${r.target.id || r.target.nodeName}`); } };
}
const PAGE = `<span class="flat-button__caption-x1">PBID: PB-1</span>
  <button class="navigation__button" id="navBE">Business Entity</button><button class="navigation__button" id="navCO">Company</button><a id="expandLink" href="#">Expand</a>
  <input type="text" id="webURL" value=""><input type="button" value="Add/Edit Industry" id="addIndustry"><input type="button" id="saveBusinessEntityButton" value="Save changes" disabled>
  <div>Input By: Poulomi.Roy, 09/16/2019 04:48 Last Edit By: T.K.R., 04/06/2026 11:43</div>`;
const press = (shadow, label) => Array.from(shadow.querySelectorAll("button")).find((b) => b.textContent === label);
const pasteValid = (shadow) => {
  const area = shadow.querySelector("#sxrts-response");
  area.value = JSON.stringify({ schemaVersion: "1.0", profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" }, businessEntity: { websiteAddresses: [{ value: "www.psypher.in", action: "addIfMissing" }] } });
  area.dispatchEvent(new window.Event("input", { bubbles: true }));
};

test("opening the panel, pasting, validating and opening every window of the panel never clicks, types into or changes the RTS page", async () => {
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("afterbegin", PAGE);
  const watch = watchPage(shadow);
  pasteValid(shadow);
  press(shadow, "Validate JSON").click();
  for (const label of ["Mappings", "Output rules", "Teach new field", "History", "Undo"]) press(shadow, label)?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  watch.flush();
  assert.deepEqual(watch.seen, [], "nothing on the RTS page was touched");
  // the watcher itself works: a click on the page is seen
  document.getElementById("addIndustry").click();
  assert.ok(watch.seen.some((e) => e.startsWith("click:")), "the watcher sees a click on the RTS page");
});

test("Pause: Publish refuses, nothing in RTS is touched, and Resume lets it run again", async () => {
  await globalThis.SXRTS.runControl.set(false);
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("afterbegin", PAGE);
  const watch = watchPage(shadow);
  pasteValid(shadow);
  press(shadow, "Validate JSON").click();
  press(shadow, "Pause").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(press(shadow, "Resume") instanceof window.HTMLElement, true, "the button now says Resume");
  assert.ok(!shadow.querySelector("#sxrts-paused").classList.contains("hidden"), "the banner says it is paused");
  press(shadow, "Publish and save").click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  watch.flush();
  assert.match(shadow.querySelector(".pbar ~ .status, .status").textContent + shadow.querySelector("#sxrts-paused").textContent, /Paused|paused/);
  assert.deepEqual(watch.seen, []);
  press(shadow, "Teach new field").click();
  assert.ok(!shadow.querySelector("#sxrts-paused").classList.contains("hidden"));
  press(shadow, "Resume").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(shadow.querySelector("#sxrts-paused").classList.contains("hidden"));
  assert.equal(globalThis.SXRTS.runControl.isPaused(), false);
});

test("Pause pressed during a publish: the steps that had not started are not run, and each says so", async () => {
  await globalThis.SXRTS.runControl.set(false);
  const { shadow } = setupDom();
  document.body.insertAdjacentHTML("afterbegin", PAGE);
  pasteValid(shadow);
  press(shadow, "Validate JSON").click();
  const watch = watchPage(shadow);
  window.confirm = () => { globalThis.SXRTS.runControl.set(true); return true; }; // Pause is pressed right after Publish is confirmed
  press(shadow, "Publish and save").click();
  for (let i = 0; i < 120 && !/Paused: this step was not run/.test(shadow.textContent); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  watch.flush();
  const text = shadow.textContent;
  assert.match(text, /Paused: this step was not run/);
  assert.deepEqual(watch.seen.filter((e) => /^(click|input|change|keydown):/.test(e) && !/navBE|navCO|expandLink/.test(e)), [], "no field was clicked or typed into");
  await globalThis.SXRTS.runControl.set(false);
});

test("before publishing, the researcher is told which windows will open and whether RTS already shows an edit today", async () => {
  await globalThis.SXRTS.runControl.set(false);
  const { shadow } = setupDom();
  const today = new Date();
  document.body.insertAdjacentHTML("afterbegin", PAGE.replace("T.K.R., 04/06/2026 11:43", `Abhishek.Tawte, ${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()} 09:15`));
  await globalThis.SXRTS.customFields.saveDefinition({
    key: "extrasIndustryCode", label: "Industry code", description: "", kind: "single",
    fields: [{ key: "value", label: "Industry code", description: "", kind: "tree" }],
    openButton: { selectors: ["#addIndustry"], text: "Add/Edit Industry" }, saveButton: { selectors: ["#save"], text: "Save Changes" },
    window: { path: "/industryGroup/create.html", preSave: [], tree: { leaf: { selectors: ["div.controls_checkBox"], text: "" }, expander: { selectors: ["[id^=industryControlGroup]"], text: "" } } },
    binds: { path: "extras.industryCode", map: { value: "value" } }
  });
  const area = shadow.querySelector("#sxrts-response");
  area.value = JSON.stringify({ schemaVersion: "1.0", profileIdentity: { companyName: "Psypher", pbId: "PB-1", domain: "psypher.in" }, custom: {}, extras: { industryCode: { value: "1.2.4 — Consulting Services", action: "addIfMissing" } } });
  area.dispatchEvent(new window.Event("input", { bubbles: true }));
  press(shadow, "Validate JSON").click();
  let asked = "";
  window.confirm = (message) => { asked = message; return false; };
  press(shadow, "Publish and save").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(asked, /Publish \d+ field\(s\) to RTS now\?/);
  assert.match(asked, /Windows that will open: Industry code/);
  assert.match(asked, /RTS already shows an edit dated today \(Abhishek\.Tawte\) before this publish: the extension has not written anything yet/);
  await globalThis.SXRTS.customFields.removeDefinition("extrasIndustryCode");
});
