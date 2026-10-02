// Taught-field definitions: validation, JSON payload validation, prompt
// splice-in, execution plan, and the last-pasted-JSON cache.

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import "../core/schema.js";
import "../core/identityLock.js";
import "../core/cache.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/customFields.js";
import "../core/promptBuilder.js";
import "../core/outputFields.js";
import "../core/executionPlan.js";

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

const cf = globalThis.SXRTS.customFields;

const singleDef = {
  key: "foundedYear", label: "Founded year", description: "Year the company was founded", kind: "single",
  fields: [{ key: "value", kind: "text", selectors: ["#foundedYear"] }],
  saveButton: { selectors: ["#saveCompany"], text: "Save" }
};
const recordDef = {
  key: "awards", label: "Awards", description: "Notable awards", kind: "record",
  fields: [
    { key: "title", kind: "text", description: "Award name", selectors: ["input.awardTitle"] },
    { key: "level", kind: "select", selectors: ["select.awardLevel"], options: [{ label: "Gold", value: "G" }, { label: "Silver", value: "S" }] }
  ],
  addButton: { selectors: ["#addAward"], text: "Add" },
  saveButton: { selectors: ["#saveAwards"], text: "Save" }
};

test("a well-formed definition is accepted and persisted, then removable", async () => {
  assert.deepEqual(cf.validateDefinition(singleDef), []);
  await cf.saveDefinition(singleDef);
  assert.equal(cf.getCached().length, 1);
  assert.equal(store.get("sxrts_custom_fields").length, 1);
  await cf.removeDefinition("foundedYear");
  assert.equal(cf.getCached().length, 0);
});

test("invalid definitions are rejected with plain-language errors", () => {
  assert.ok(cf.validateDefinition({ ...singleDef, key: "Bad Key" }).length);
  assert.ok(cf.validateDefinition({ ...singleDef, label: "<b>x</b>" }).length);
  assert.ok(cf.validateDefinition({ ...singleDef, saveButton: null }).some((e) => /Save button/.test(e)));
  assert.ok(cf.validateDefinition({ ...recordDef, addButton: null }).some((e) => /Add button/.test(e)));
  assert.ok(cf.validateDefinition({ ...recordDef, fields: [{ ...recordDef.fields[0], key: "action" }] }).some((e) => /reserved/.test(e)));
});

test("a taught key cannot shadow a built-in field name", async () => {
  await assert.rejects(() => cf.saveDefinition({ ...singleDef, key: "nameVariations" }), /built-in/);
});

test("payload validation: valid single + record, normalizes dropdown labels and numbers", async () => {
  await cf.saveDefinition(singleDef);
  await cf.saveDefinition(recordDef);
  const result = cf.validatePayload({
    foundedYear: { value: 1997, action: "addIfMissing", source: "https://example.com/about" },
    awards: [{ title: "Best Co", level: "gold", action: "addIfMissing" }]
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.foundedYear.value, "1997");
  assert.equal(result.value.awards[0].level, "Gold");
});

test("payload validation: unsupported dropdown value, bad action and bad source are errors; unknown key is a warning", () => {
  const result = cf.validatePayload({
    awards: [{ title: "x", level: "Bronze", action: "addIfMissing" }],
    foundedYear: { value: "1997", action: "nope", source: "http://insecure" },
    mystery: { value: "x", action: "addIfMissing" }
  });
  // One error per bad entry (the first problem found in it).
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some((e) => /Supported: Gold, Silver/.test(e)));
  assert.ok(result.errors.some((e) => /action must be one of/.test(e)));
  assert.ok(result.warnings.some((w) => /custom\.mystery/.test(w)));
  assert.match(cf.validateRecord(cf.getDefinition("foundedYear"), { value: "1997", action: "addIfMissing", source: "http://insecure" }), /https/);
});

test("the prompt includes taught fields' shape, descriptions and dropdown catalogs", () => {
  const prompt = globalThis.SXRTS.promptBuilder.buildPrompt({ companyName: "Acme", domain: "acme.com" });
  assert.match(prompt, /"custom": \{/);
  assert.match(prompt, /custom\.foundedYear \(Founded year\): Year the company was founded/);
  assert.match(prompt, /Supported values \(custom\.awards\[\]\.level\):\n- Gold\n- Silver/);
  const instructions = globalThis.SXRTS.promptBuilder.buildAgentInstructions();
  assert.match(instructions, /custom\.awards/);
});

test("with no taught fields the prompt has no custom section", async () => {
  await cf.removeDefinition("foundedYear");
  await cf.removeDefinition("awards");
  const prompt = globalThis.SXRTS.promptBuilder.buildPrompt({ companyName: "Acme", domain: "acme.com" });
  assert.doesNotMatch(prompt, /"custom"/);
});

test("the execution plan creates pending actions for taught fields and skips null values", async () => {
  await cf.saveDefinition(singleDef);
  await cf.saveDefinition(recordDef);
  const validated = globalThis.SXRTS.schema.validate(JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Acme", domain: "acme.com" },
    custom: {
      foundedYear: { value: "1997", action: "addIfMissing" },
      awards: [{ title: "Best Co", level: "Gold", action: "addIfMissing" }, { title: null, level: null, action: "addIfMissing" }]
    }
  }));
  validated.custom = cf.validatePayload(validated.custom).value;
  const actions = globalThis.SXRTS.executionPlan.buildExecutionPlan(validated).filter((a) => a.jsonPath.startsWith("custom."));
  assert.deepEqual(actions.map((a) => a.jsonPath), ["custom.foundedYear", "custom.awards"]);
  assert.ok(actions.every((a) => a.executionStatus === "pending"));
});

test("the last pasted JSON is stored per profile and separate from the plan cache", async () => {
  const identity = { pbId: "862926-85", domain: "dmcspain.com" };
  await globalThis.SXRTS.cache.setLastJson(identity, '{"a":1}');
  assert.equal((await globalThis.SXRTS.cache.getLastJson(identity)).text, '{"a":1}');
  assert.equal(await globalThis.SXRTS.cache.getProfileCache(identity), null);
  assert.equal(await globalThis.SXRTS.cache.getLastJson({ pbId: "other" }), null);
  await globalThis.SXRTS.cache.clearLastJson(identity);
  assert.equal(await globalThis.SXRTS.cache.getLastJson(identity), null);
});
