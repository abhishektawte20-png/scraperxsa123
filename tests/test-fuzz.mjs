// Robustness: a damaged output (keys removed, wrong types, nulls, empty text, numbers where text belongs...) is either read
// (with the damaged values left out) or refused with a normal validation error. It must never crash the panel with a
// programming error, and anything that is read must still build a plan without throwing.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../core/identityLock.js";
import "../core/duplicates.js";
import "../core/jsonRepair.js";
import "../core/outputFields.js";
import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import "../core/resultsSummary.js";
import "../registry/businessEntity.general.js";
import "../registry/index.js";
import "../core/workflows/statusHistory.js";
import "../core/executionPlan.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

let seed = Number(process.env.FUZZ_SEED || 20261117);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

function paths(node, prefix = [], out = []) {
  if (node && typeof node === "object") for (const key of Object.keys(node)) { out.push([...prefix, key]); paths(node[key], [...prefix, key], out); }
  return out;
}
function setAt(root, p, fn) {
  let node = root;
  for (const key of p.slice(0, -1)) node = node[key];
  const last = p[p.length - 1];
  if (fn === "delete") { if (Array.isArray(node)) node.splice(Number(last), 1); else delete node[last]; } else node[last] = fn;
}
const DAMAGE = [() => "delete", () => null, () => "", () => 42, () => true, () => [], () => ({}), () => "Not found on the official website.", () => "x", () => "https://pitchbook.com/x", () => "艾克美", () => "12"];

test("500 damaged outputs: each is read or refused cleanly, and what is read builds a plan", () => {
  let read = 0;
  let refused = 0;
  for (let n = 0; n < Number(process.env.FUZZ_N || 500); n++) {
    const doc = validOutput();
    const hits = 1 + Math.floor(rnd() * 3);
    for (let h = 0; h < hits; h++) {
      const all = paths(doc);
      if (!all.length) break;
      try { setAt(doc, pick(all), pick(DAMAGE)()); } catch { /* the path vanished after an earlier damage */ }
    }
    const text = JSON.stringify(doc);
    let validated;
    try {
      validated = globalThis.SXRTS.schema.validate(text, { domain: "acme.com" });
      read++;
    } catch (error) {
      assert.ok(error instanceof globalThis.SXRTS.schema.SchemaValidationError || /^SchemaValidationError$/.test(error?.name), `crash on damaged output #${n}: ${error?.stack || error}\n${text.slice(0, 300)}`);
      refused++;
      continue;
    }
    assert.doesNotThrow(() => globalThis.SXRTS.executionPlan.buildExecutionPlan(validated), `plan failed for damaged output #${n}`);
  }
  assert.ok(read > 100, `only ${read} were read`);
  console.log(`  read ${read}, refused ${refused}`);
});
