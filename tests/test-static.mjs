// Static, browser-free tests for the foundation layer (schema, identity
// comparison, cache, state machine, execution plan, duplicate detection)
// plus manifest/CSP checks.
//
// DOM-dependent behavior lives in separate jsdom-based test files:
// identityLock.readRtsIdentityFromPage() -> test-identity-lock.mjs,
// the Name Variations workflow -> test-name-variations.mjs. Everything
// else that still needs a real RTS DOM stays untested until evidenced
// (see docs/evidence-checklist.md).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

import "../core/schema.js";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/cache.js";
import "../core/stateMachine.js";
import "../registry/businessEntity.nameVariations.js";
import "../registry/businessEntity.general.js";
import "../registry/company.sic.js";
import "../registry/company.sites.js";
import "../registry/index.js";
import "../core/promptBuilder.js";
import "../core/executionPlan.js";

const { schema, identityLock, duplicates, cache, stateMachine, registry, executionPlan, promptBuilder } = globalThis.SXRTS;

function validJson(overrides = {}) {
  return JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: "PB-1", entityId: null, domain: "psypher.in" },
    businessEntity: {},
    company: {},
    ...overrides
  });
}

// ---- Manifest / CSP ----

test("manifest requests only activeTab, scripting, and storage", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions.slice().sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.manifest_version, 3);
});

test("CSP blocks remote script and network connections", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /object-src 'none'/);
});

// ---- Schema validation ----

test("accepts a minimal valid document", () => {
  const result = schema.validate(validJson());
  assert.equal(result.schemaVersion, "1.0");
  assert.equal(result.profileIdentity.companyName, "Psypher");
});

test("strips code fences before parsing", () => {
  const result = schema.validate("```json\n" + validJson() + "\n```");
  assert.equal(result.profileIdentity.pbId, "PB-1");
});

test("rejects wrong schemaVersion", () => {
  assert.throws(() => schema.validate(validJson({ schemaVersion: "2.0" })), schema.SchemaValidationError);
});

test("rejects malformed JSON", () => {
  assert.throws(() => schema.validate("{not json"), schema.SchemaValidationError);
});

test("detects markdown-link corruption with a specific, actionable message rather than a generic parse error", () => {
  const corrupted = validJson({
    businessEntity: {
      researchNotes: [{ text: "note", action: "addIfMissing", source: 'https://example.com/page/[",](https://example.com/page/%22,)' }]
    }
  });
  assert.throws(() => schema.validate(corrupted), (error) => {
    assert.ok(error instanceof schema.SchemaValidationError);
    assert.match(error.errors.join(" "), /markdown link syntax/);
    return true;
  });
});

test("rejects profileIdentity with no strong identifier", () => {
  assert.throws(() => schema.validate(validJson({ profileIdentity: { companyName: "X", pbId: null, entityId: null, domain: null } })));
});

test("reports unknown top-level keys as warnings, not errors", () => {
  const result = schema.validate(validJson({ unexpectedKey: "value" }));
  assert.ok(result.warnings.some((w) => w.includes("unexpectedKey")));
});

test("reports unknown nested keys as warnings", () => {
  const result = schema.validate(validJson({ company: { notARealField: true } }));
  assert.ok(result.warnings.some((w) => w.includes("company.notARealField")));
});

test("accepts null envelope value (unverified) but rejects wrong type", () => {
  const ok = schema.validate(validJson({ company: { briefDescription: { value: null, action: "skip" } } }));
  assert.equal(ok.company.briefDescription.value, null);
  assert.throws(() => schema.validate(validJson({ company: { briefDescription: { value: 42, action: "skip" } } })));
});

test("rejects invalid date format", () => {
  const bad = validJson({
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing", sourceDate: "2024-01-01" }] }
  });
  assert.throws(() => schema.validate(bad));
});

test("accepts valid MM/DD/YYYY date", () => {
  const good = validJson({
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing", sourceDate: "01/15/2024" }] }
  });
  assert.doesNotThrow(() => schema.validate(good));
});

test("rejects a website address with a non-web URL scheme", () => {
  const bad = validJson({ businessEntity: { websiteAddresses: [{ value: "ftp://psypher.in", action: "addIfMissing" }] } });
  assert.throws(() => schema.validate(bad));
});

test("accepts an http:// website address and upgrades it to https://", () => {
  const good = validJson({ businessEntity: { websiteAddresses: [{ value: "http://psypher.in", action: "addIfMissing" }] } });
  const result = schema.validate(good);
  assert.equal(result.businessEntity.websiteAddresses[0].value, "https://psypher.in");
});

test("accepts a bare domain with a trailing slash", () => {
  const good = validJson({ businessEntity: { websiteAddresses: [{ value: "aromagrowstore.com/", action: "addIfMissing" }] } });
  assert.doesNotThrow(() => schema.validate(good));
});

test("accepts a bare domain in a source field and normalizes it to https://", () => {
  const result = schema.validate(validJson({
    businessEntity: {
      nameVariations: [{ name: "Aroma Grow Store", type: "Legal Name", action: "addIfMissing", source: "www.aromagrowstore.com" }]
    },
    company: {
      industries: [{ sector: null, group: null, code: "1", action: "addIfMissing", source: "aromagrowstore.com" }]
    }
  }));
  assert.equal(result.businessEntity.nameVariations[0].source, "https://www.aromagrowstore.com");
  assert.equal(result.company.industries[0].source, "https://aromagrowstore.com");
});

test("normalizes a bare domain source in an envelope-shaped field too", () => {
  const result = schema.validate(validJson({
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  }));
  assert.equal(result.businessEntity.nameVariations[0].source, null);

  const withEnvelopeSource = schema.validate(validJson({
    company: { briefDescription: { value: "A company.", action: "addIfMissing", source: "www.example.com" } }
  }));
  assert.equal(withEnvelopeSource.company.briefDescription.source, "https://www.example.com");
});

test("a bare `null` for a whole envelope field is treated as \"nothing to propose,\" not a shape error", () => {
  // Real observed failure: Rovo sent "emailDefaultStructure": null instead
  // of the nested {value: null, action: "skip"} shape, which used to hard
  // -fail the whole response (checkEnvelope requires an object).
  const result = schema.validate(validJson({
    businessEntity: { emailDefaultStructure: null },
    company: { startDate: null, briefDescription: null, fullDescription: null, searchKeywords: null }
  }));
  assert.equal("emailDefaultStructure" in result.businessEntity, false);
  assert.equal("startDate" in result.company, false);
  assert.equal("briefDescription" in result.company, false);
  assert.equal("fullDescription" in result.company, false);
  assert.equal("searchKeywords" in result.company, false);
});

test("accepts an http:// website address or source and upgrades it to https://", () => {
  // Real observed failure: Rovo sent "http://www.aromagrowstore.com" for
  // websiteAddresses[].value, which previously matched neither the
  // https-URL check nor the bare-domain regex (which forbids any scheme).
  const result = schema.validate(validJson({
    businessEntity: {
      websiteAddresses: [{ value: "http://www.aromagrowstore.com", action: "addIfMissing" }],
      nameVariations: [{ name: "Aroma Grow Store", type: "Legal Name", action: "addIfMissing", source: "http://www.aromagrowstore.com/about/" }]
    }
  }));
  assert.equal(result.businessEntity.websiteAddresses[0].value, "https://www.aromagrowstore.com");
  assert.equal(result.businessEntity.nameVariations[0].source, "https://www.aromagrowstore.com/about/");
});

test("still rejects garbled, non-URL, non-domain text in a source field", () => {
  const bad = validJson({
    company: { verticals: [{ value: "Cannabis Retail", action: "addIfMissing", source: "Aroma Grow Store opens in Niles - Illinois News Joint in-niles/" }] }
  });
  assert.throws(() => schema.validate(bad), /must be a valid HTTPS or HTTP URL, a bare domain \(e\.g\. www\.example\.com\), or null/);
});

test("normalizes a literal \"null\" string to real null in emailDefaultStructure (real observed failure)", () => {
  // Real observed failure: Rovo wrote the STRING "null" instead of the
  // JSON literal null. isNullableString technically accepts any string,
  // so this used to pass validation, build a "pending" action, and then
  // throw deep inside the workflow: '"null" is not a supported Email
  // Default Structure value.'
  const result = schema.validate(validJson({
    businessEntity: { emailDefaultStructure: { value: "null", action: "addIfMissing" } }
  }));
  assert.equal(result.businessEntity.emailDefaultStructure.value, null);

  const actions = executionPlan.buildExecutionPlan(result);
  assert.equal(actions.some((a) => a.jsonPath === "businessEntity.emailDefaultStructure"), false, "a null value should never become a pending action");
});

test("normalizes a literal \"null\" string in briefDescription, fullDescription, searchKeywords, and profileIdentity fields too", () => {
  const result = schema.validate(validJson({
    profileIdentity: { companyName: "Aroma Grow Store", domain: "aromagrowstore.com", pbId: "NULL" },
    company: {
      briefDescription: { value: "null", action: "addIfMissing" },
      fullDescription: { value: "Null", action: "addIfMissing" },
      searchKeywords: { value: " null ", action: "addIfMissing" }
    }
  }));
  assert.equal(result.profileIdentity.pbId, null);
  assert.equal(result.company.briefDescription.value, null);
  assert.equal(result.company.fullDescription.value, null);
  assert.equal(result.company.searchKeywords.value, null);
});

test("the Rovo agent's own \"anc\" provenance key is dropped silently, not warned about", () => {
  const result = schema.validate(validJson({ anc: { accepted_used: [], rejected_not_used: [] } }));
  assert.equal(result.warnings.some((w) => w.includes("anc")), false);
});

test("rejects unsupported action value", () => {
  const bad = validJson({ company: { keywords: [{ value: "fintech", action: "forceReplace" }] } });
  assert.throws(() => schema.validate(bad));
});

// ---- Identity lock ----

test("identity match when domain agrees", () => {
  const result = identityLock.compareIdentity({ domain: "www.psypher.in" }, { domain: "psypher.in" });
  assert.equal(result.status, "match");
});

test("identity mismatch when pbId disagrees", () => {
  const result = identityLock.compareIdentity({ pbId: "PB-1" }, { pbId: "PB-2" });
  assert.equal(result.status, "mismatch");
});

test("identity insufficient when no strong identifier overlaps", () => {
  const result = identityLock.compareIdentity({ companyName: "Psypher" }, {});
  assert.equal(result.status, "insufficient");
});

// ---- Duplicate detection ----

test("detects a duplicate name variation by normalized name+type", () => {
  const existing = [{ name: "Psypher  Inc.", type: "Legal Name" }];
  const isDup = duplicates.isDuplicateRecord(existing, { name: "psypher inc.", type: "legal name" }, ["name", "type"]);
  assert.equal(isDup, true);
});

test("does not flag different types as duplicates", () => {
  const existing = [{ name: "Psypher", type: "Legal Name" }];
  const isDup = duplicates.isDuplicateRecord(existing, { name: "Psypher", type: "Former Name" }, ["name", "type"]);
  assert.equal(isDup, false);
});

test("detects duplicate SMI by network+handle", () => {
  const existing = [{ network: "LinkedIn", handleOrUrl: "https://linkedin.com/company/psypher" }];
  const isDup = duplicates.isDuplicateRecord(existing, { network: "linkedin", handleOrUrl: "HTTPS://LINKEDIN.COM/COMPANY/PSYPHER" }, ["network", "handleOrUrl"]);
  assert.equal(isDup, true);
});

// ---- State machine ----

test("allows the full happy-path transition sequence", () => {
  const path = ["pending", "validated", "navigating", "editing", "valueVerified", "awaitingSave", "saving", "saved", "savedValueVerified"];
  let current = path[0];
  for (const next of path.slice(1)) {
    current = stateMachine.transition(current, next);
  }
  assert.equal(current, "savedValueVerified");
  assert.equal(stateMachine.isComplete(current), true);
});

test("rejects skipping straight from editing to saved", () => {
  assert.throws(() => stateMachine.transition("editing", "saved"));
});

test("valueVerified and editing are never treated as complete", () => {
  assert.equal(stateMachine.isComplete("editing"), false);
  assert.equal(stateMachine.isComplete("valueVerified"), false);
});

// ---- Cache separation ----

test("different profiles get different cache keys", () => {
  const keyA = cache.profileKeyFor({ pbId: "PB-1" });
  const keyB = cache.profileKeyFor({ pbId: "PB-2" });
  assert.notEqual(keyA, keyB);
});

test("cache key falls back to normalized domain when no pbId/entityId", () => {
  const key = cache.profileKeyFor({ domain: "WWW.Psypher.in/" });
  assert.match(key, /psypher\.in$/);
});

test("cache key throws when identity has no usable identifier", () => {
  assert.throws(() => cache.profileKeyFor({}));
});

test("input hash changes when the input changes", async () => {
  const hashA = await cache.computeInputHash({ a: 1 });
  const hashB = await cache.computeInputHash({ a: 2 });
  const hashA2 = await cache.computeInputHash({ a: 1 });
  assert.notEqual(hashA, hashB);
  assert.equal(hashA, hashA2);
});

test("profile cache get/set/clear round-trips through chrome.storage.local", async () => {
  const store = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        async remove(key) { store.delete(key); }
      }
    }
  };
  const identity = { pbId: "PB-1" };
  assert.equal(await cache.getProfileCache(identity), null);
  await cache.setProfileCache(identity, { executionPlan: [] });
  const stored = await cache.getProfileCache(identity);
  assert.deepEqual(stored.executionPlan, []);
  await cache.clearProfileCache(identity);
  assert.equal(await cache.getProfileCache(identity), null);
});

// ---- Execution plan ----

test("skips fields with no registry entry at all", () => {
  const validated = schema.validate(validJson({ company: { briefDescription: { value: "A company.", action: "addIfMissing" } } }));
  const actions = executionPlan.buildExecutionPlan(validated);
  const action = actions.find((a) => a.jsonPath === "company.briefDescription");
  assert.equal(action.executionStatus, "skipped");
  assert.match(action.skipReason, /No selector registry entry/);
});

test("businessEntity.nameVariations is evidenced and ready", () => {
  assert.equal(registry.isReady("businessEntity.nameVariations"), true);
});

test("skips fields registered but not yet evidenced", () => {
  // Register a throwaway "missing" entry under a jsonPath no real
  // registry file uses, so this test doesn't depend on — or collide
  // with — which real fields happen to be evidenced.
  globalThis.SXRTS.registryEntries.push({
    key: "company.employeeHistory",
    area: "Company",
    evidenceStatus: "missing",
    saveButton: {}
  });
  const validated = schema.validate(validJson({
    company: { employeeHistory: [{ count: 10, action: "addIfMissing" }] }
  }));
  const actions = executionPlan.buildExecutionPlan(validated);
  const action = actions.find((a) => a.jsonPath === "company.employeeHistory");
  assert.equal(action.executionStatus, "skipped");
  assert.match(action.skipReason, /marked "missing"/);
});

test("builds a pending (not skipped) action for an evidenced, ready field", () => {
  const validated = schema.validate(validJson({
    businessEntity: { nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing" }] }
  }));
  const actions = executionPlan.buildExecutionPlan(validated);
  const action = actions.find((a) => a.jsonPath === "businessEntity.nameVariations");
  assert.equal(action.executionStatus, "pending");
  assert.equal(action.area, "Business Entity");
});

test("does not build an action for an explicit skip", () => {
  const validated = schema.validate(validJson({ company: { keywords: [{ value: "fintech", action: "skip" }] } }));
  const actions = executionPlan.buildExecutionPlan(validated);
  assert.equal(actions.some((a) => a.jsonPath === "company.keywords"), false);
});

test("does not build an action for an unset envelope value", () => {
  const validated = schema.validate(validJson({ company: { startDate: { value: null, action: "updateIfBlank" } } }));
  const actions = executionPlan.buildExecutionPlan(validated);
  assert.equal(actions.some((a) => a.jsonPath === "company.startDate"), false);
});

test("an envelope field's proposedValue is the full record (value/action/source/confidence), never a bare scalar", () => {
  // Regression test: proposedValue was previously unwrapped to record.value
  // for envelope-kind fields, so the workflow received a bare string where
  // it expected an object with .action/.value — applyEmailDefaultStructureValue
  // would then throw "'undefined' is not a supported Email Default
  // Structure value" on every real publish attempt.
  const validated = schema.validate(validJson({
    businessEntity: { emailDefaultStructure: { value: "FirstName@domain.com", action: "addIfMissing", confidence: "high" } }
  }));
  const actions = executionPlan.buildExecutionPlan(validated);
  const action = actions.find((a) => a.jsonPath === "businessEntity.emailDefaultStructure");
  assert.equal(typeof action.proposedValue, "object");
  assert.equal(action.proposedValue.value, "FirstName@domain.com");
  assert.equal(action.proposedValue.action, "addIfMissing");
  assert.equal(action.proposedValue.confidence, "high");
});

test("only the first proposed Website Address is ever pending; extras are skipped with a specific reason", () => {
  const validated = schema.validate(validJson({
    businessEntity: {
      websiteAddresses: [
        { value: "www.example.com", action: "addIfMissing" },
        { value: "www.alt-example.com", action: "addIfMissing" }
      ]
    }
  }));
  const actions = executionPlan.buildExecutionPlan(validated).filter((a) => a.jsonPath === "businessEntity.websiteAddresses");
  assert.equal(actions.length, 2);
  assert.equal(actions[0].executionStatus, "pending");
  assert.equal(actions[1].executionStatus, "skipped");
  assert.match(actions[1].skipReason, /only one Website Address field/);
});

// ---- Prompt builder ----

test("prompt includes the company name and website", () => {
  const prompt = promptBuilder.buildPrompt({ companyName: "Psypher", domain: "www.psypher.in" });
  assert.match(prompt, /Company name: Psypher/);
  assert.match(prompt, /Official website: www\.psypher\.in/);
});

test("agent instructions carry the same shape/rules/catalogs but no company-specific line, and forbid prose", () => {
  const instructions = promptBuilder.buildAgentInstructions();
  assert.match(instructions, /Company name: <name>/); // a placeholder, not a real value baked in
  assert.match(instructions, /no section headers, no bullet points/);
  assert.match(instructions, /"schemaVersion": "1\.0"/);
  for (const label of ["Familiar Name", "Morningstar", "Primary HQ", "United States"]) {
    assert.ok(instructions.includes(label), `agent instructions should include "${label}"`);
  }
});

test("prompt lists every evidenced Name Type, Email Default Structure, and SIC Source option", () => {
  const prompt = promptBuilder.buildPrompt({});
  for (const label of registry.getField("businessEntity.nameVariations").form.typeDropdown.options.map((o) => o.label)) {
    assert.ok(prompt.includes(label), `missing Name Type "${label}"`);
  }
  assert.equal((registry.getField("businessEntity.emailDefaultStructure").form.select.options.map((o) => o.label))
    .filter((label) => !prompt.includes(label)).length, 0);
  for (const label of ["Morningstar", "PitchBook", "SEC"]) {
    assert.ok(prompt.includes(label), `missing SIC Source "${label}"`);
  }
});

test("prompt output is itself accepted by the schema validator once wrapped in real values", () => {
  const sample = JSON.stringify({
    schemaVersion: "1.0",
    profileIdentity: { companyName: "Psypher", pbId: null, entityId: null, domain: "psypher.in" },
    businessEntity: {
      nameVariations: [{ name: "Psypher Inc", type: "Legal Name", action: "addIfMissing", source: "https://psypher.in/about", sourceDate: null, confidence: "high" }],
      emailDefaultStructure: { value: "FirstName@domain.com", action: "addIfMissing", source: null, confidence: "medium" }
    },
    company: {
      sicCodes: [{ code: "7372", classificationSource: "PitchBook", action: "addIfMissing", source: null }]
    }
  });
  assert.doesNotThrow(() => schema.validate(sample));
});

test("prompt includes worked examples of every real failure mode seen so far", () => {
  const prompt = promptBuilder.buildPrompt({});
  assert.match(prompt, /Not found on the official website/);
  assert.match(prompt, /\[aromagrowstore\.com\]\(http:\/\/aromagrowstore\.com\/\)/);
  assert.match(prompt, /SECTION 1: Entity Details/);
  assert.match(prompt, /bare domain \(e\.g\. "example\.com"\) in any "source"/);
  assert.match(prompt, /a bare null for the whole field/);
  assert.match(prompt, /plain HTTP is almost never the real citation URL/);
  assert.match(prompt, /the word null as literal text, in quotes/);
});

test("prompt requests the full evidenced scope (sites, industries, keywords, etc.) but never a management field", () => {
  const prompt = promptBuilder.buildPrompt({});
  for (const key of ["briefDescription", "fullDescription", "keywords", "industries", "verticals", "employeeHistory", "naicsCodes", "sites", "socialMediaIdentifiers"]) {
    assert.ok(prompt.includes(key), `prompt should request "${key}"`);
  }
  const shapeStart = prompt.indexOf("Required JSON shape:");
  const shapeEnd = prompt.indexOf("\n\n", shapeStart);
  const requiredShape = JSON.parse(prompt.slice(prompt.indexOf("{", shapeStart), shapeEnd));
  assert.equal(requiredShape.company.management, undefined);
  assert.match(prompt, /out of scope/i); // the explicit "do not research management" instruction is still present
});

test("prompt lists the full evidenced Site Type, Site Status, and Country catalogs", () => {
  const prompt = promptBuilder.buildPrompt({});
  for (const label of ["Primary HQ", "Regional HQ", "Regional Office"]) assert.ok(prompt.includes(label));
  for (const label of ["Current", "Former"]) assert.ok(prompt.includes(label));
  for (const label of ["United States", "Germany", "Zimbabwe"]) assert.ok(prompt.includes(label));
});
