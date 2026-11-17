// One bad value never rejects the whole paste: it is left out (never written to RTS) and said so. What still blocks:
// a halt, a different domain, an unreadable paste.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/jsonRepair.js";
import "../core/outputFields.js";
import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

const validate = (o, domain = "acme.com") => globalThis.SXRTS.schema.validate(JSON.stringify(o), { domain });
const leftOut = (v) => v.warnings.filter((w) => /^\[LEFT_OUT\]/.test(w));

test("the compliant sample still validates with nothing left out", () => {
  assert.equal(leftOut(validate(validOutput())).length, 0);
});

test("a malformed SIC code is left out, the good ones stay, and there is no error", () => {
  const o = validOutput();
  o.sic_codes[0].code = "12";
  const v = validate(o);
  assert.equal(leftOut(v).length, 1);
  assert.match(leftOut(v)[0], /sic_codes\[0\]\.code/);
  const codes = (v.company.sicCodes ?? []).map((c) => c.code ?? c.value);
  assert.ok(!codes.includes("12"));
});

test("a keyword that breaks the format is left out; the other keywords are kept", () => {
  const o = validOutput();
  o.keywords[2] = "one two three four five";
  const v = validate(o);
  assert.ok(leftOut(v).some((w) => /keywords/.test(w)));
  const words = (v.company.keywords ?? []).map((k) => k.value ?? k);
  assert.ok(!words.includes("one two three four five"));
  assert.ok(words.includes("fleet management"));
});

test("a prohibited source inside a written field leaves that value out, not the report", () => {
  const o = validOutput();
  o.employee_count.current.source_url = "https://www.tracxn.com/x";
  const v = validate(o);
  assert.ok(leftOut(v).some((w) => /tracxn/.test(w)));
});

test("still blocked: a halted extraction, and unreadable text", () => {
  const halted = { extraction_status: "halted", halt_reason: "Entity cannot be confidently identified from the official website.", target_domain: "acme.com", extraction_date: "01 Oct 2026", anc: { accepted_used: "AIGEN_SRX_V1_Y", rejected_not_used: "AIGEN_SRX_V1_N" } };
  assert.throws(() => validate(halted), (e) => e.errors.some((m) => /HALTED/.test(m)));
  assert.throws(() => globalThis.SXRTS.schema.validate("this is not a report", { domain: "acme.com" }));
});

test("a section the agent left out is not written, and does not stop the rest", () => {
  const o = validOutput();
  delete o.verticals;
  delete o.sic_codes;
  const v = validate(o);
  assert.ok(leftOut(v).some((w) => /verticals/.test(w)));
  assert.ok(v.businessEntity.nameVariations.length >= 1);
});

test("a missing header key is still filled from the panel domain, and with no domain at all it is still rejected", () => {
  const o = validOutput();
  delete o.target_domain;
  assert.ok(validate(o).profileIdentity.domain);
  assert.throws(() => globalThis.SXRTS.schema.validate(JSON.stringify(o), { domain: "" }));
});

test("the real las.app.br output that sent a researcher back to the agent (three web addresses with %22 instead of a closing quote) validates the first time, with all its data", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("./helpers/las-output.json", import.meta.url), "utf8");
  const v = globalThis.SXRTS.schema.validate(raw, { domain: "las.app.br" });
  const repaired = v.warnings.find((w) => /^\[JSON_REPAIRED\]/.test(w));
  assert.match(repaired, /closed a web address whose closing quote mark was written as %22/);
  assert.deepEqual(v.businessEntity.nameVariations.map((n) => n.name), ["L.A.S. DO BRASIL COMÉRCIO DE PRODUTOS ANALÍTICOS E LABORATORIAIS LTDA", "Laboratory Analytical Solutions", "LAS do Brasil"]);
  assert.equal(v.company.keywords.length, 10);
  assert.deepEqual(v.company.sicCodes.map((c) => c.code), ["5047", "5169"]);
  assert.equal(v.rovo.issues.filter((i) => i.severity === "error").length, 0);
  // the repaired addresses are exactly the ones the agent meant
  const yt = JSON.stringify(v);
  assert.match(yt, /https:\/\/www\.youtube\.com\/@LasdoBrasil-ofc"/);
});
