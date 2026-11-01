// RTS message boxes during a run, the compulsory ANC mark, native names, and quiet source notes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "https://rts.pitchbook.com/x" });
const win = dom.window;
global.window = win; global.document = win.document; global.HTMLElement = win.HTMLElement;
globalThis.SXRTS = {};
const shown = [];
win.alert = (m) => { shown.push(["alert", m]); };
win.confirm = (m) => { shown.push(["confirm", m]); return false; };
vm.runInContext(readFileSync(path.join(here, "../core/dialogGuardMain.js"), "utf8"), dom.getInternalVMContext());
await import("../core/dialogLog.js");
await import("../core/rovoContract.js");
await import("../core/executionPlan.js");
const log = globalThis.SXRTS.dialogLog;

test("outside a run, RTS's own message boxes are shown as usual", () => {
  shown.length = 0;
  win.alert("hello");
  assert.equal(win.confirm("sure?"), false);
  assert.equal(shown.length, 2);
});

test("during a run the boxes are answered at once and written down", () => {
  shown.length = 0;
  log.begin();
  win.alert("Another site is already set as Current Primary HQ.");
  assert.equal(win.confirm("Data is not saved."), true, "a confirm is answered OK");
  assert.equal(win.confirm("Delete this site?"), false, "anything about deleting is answered Cancel");
  assert.equal(shown.length, 0, "nothing was shown, so nobody has to press OK");
  assert.ok(log.saw(/Primary HQ/i));
  const said = log.summarize(log.end());
  assert.deepEqual(said.map((m) => m.message), ["Another site is already set as Current Primary HQ.", "Data is not saved.", "Delete this site?"]);
  win.alert("after");
  assert.equal(shown.length, 1, "the guard is off again after the run");
});

test("a name in Latin letters is an ordinary Other Name even if the agent writes a script; real native script stays native", async () => {
  const { validOutput } = await import("./helpers/rovo-sample.mjs");
  const C = globalThis.SXRTS.rovoContract;
  const out = validOutput();
  out.name_variations.other_name_variations = [
    { name: "Acme Trading", script: "Latin", source_url: "https://acme.com/" },
    { name: "Café Acme", script: "English", source_url: "https://acme.com/" },
    { name: "艾克美", script: "Chinese", source_url: "https://acme.com/" },
    { name: "Акме", script: "Cyrillic", source_url: "https://acme.com/" }
  ];
  const types = C.analyze(out).document.businessEntity.nameVariations.filter((n) => /Other/.test(n.type)).map((n) => [n.name, n.type]);
  assert.deepEqual(types, [["Acme Trading", "Other Name"], ["Café Acme", "Other Name"], ["艾克美", "Native Other Name"], ["Акме", "Native Other Name"]]);
});

test("the ANC mark is always in the plan, once, and cannot be skipped", () => {
  const ep = globalThis.SXRTS.executionPlan;
  globalThis.SXRTS.registry = { getField: () => ({ evidenceStatus: "ready", area: "Business Entity", section: "General" }) };
  globalThis.SXRTS.customFields = undefined;
  globalThis.SXRTS.outputFields = { FIELDS: [], recordsFor: () => [] };
  const doc = { profileIdentity: { companyName: "A", domain: "a.com" } };
  const plan = ep.buildExecutionPlan(doc).filter((a) => a.jsonPath === "businessEntity.researchNotes");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].mandatory, true);
  assert.equal(plan[0].proposedValue.text, "AIGEN_SRX_V1_Y - Used ScraperX UI Automation Tool for research");
  assert.equal(plan[0].proposedValue.action, "addIfMissing", "it is appended, never replaces existing notes");
  const again = ep.buildExecutionPlan(doc).filter((a) => a.jsonPath === "businessEntity.researchNotes");
  assert.equal(again.length, 1, "building the plan twice never doubles it");
});

test("an agent's own research note stays, and the mark is added next to it", () => {
  const ep = globalThis.SXRTS.executionPlan;
  const doc = { profileIdentity: { companyName: "A", domain: "a.com" }, businessEntity: { researchNotes: [{ text: "Checked registry", action: "addIfMissing" }] } };
  const plan = ep.buildExecutionPlan(doc).filter((a) => a.jsonPath === "businessEntity.researchNotes");
  assert.deepEqual(plan.map((a) => a.proposedValue.text), ["Checked registry", ep.ANC_TEXT]);
  assert.deepEqual(plan.map((a) => Boolean(a.mandatory)), [false, true]);
});

test("only aggregators and hosting addresses are warnings; an ordinary outside page is a quiet note", () => {
  const C = globalThis.SXRTS.rovoContract;
  assert.equal(C.externalSeverity("revenuebase.ai"), "warning");
  assert.equal(C.externalSeverity("acme.netlify.app"), "warning");
  assert.equal(C.externalSeverity("diamondmirror.net"), "info");
  assert.equal(C.externalCode("diamondmirror.net"), "SOURCE_NOTE");
  assert.equal(C.externalCode("www.zoominfo.com"), "EXTERNAL_SOURCE");
});
