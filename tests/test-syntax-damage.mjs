// The ways a chat window or a model typically damages JSON are repaired WITHOUT changing a single value: the data read from
// the damaged text is exactly the data read from the clean text.
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

const clean = validOutput();
const pretty = JSON.stringify(clean, null, 2);
const read = (text) => { const v = globalThis.SXRTS.schema.validate(text, { domain: "acme.com" }); return JSON.stringify({ b: v.businessEntity, c: v.company, e: v.extras }); };
const baseline = read(pretty);

const damage = {
  "trailing commas before } and ]": (t) => t.replace(/\n(\s*)([}\]])/g, ",\n$1$2"),
  "curly quote marks around every string": (t) => t.replace(/"([^"\n]*)"(\s*[,:}\]])/g, "“$1”$2"),
  "wrapped in a ```json block": (t) => "```json\n" + t + "\n```",
  "chat text before and after": (t) => "Here is the result you asked for:\n\n" + t + "\n\nLet me know if you need anything else.",
  "// comments": (t) => t.replace(/^(\s*"extraction_status".*)$/m, "$1 // status"),
  "a web address that lost its closing quote (%22)": (t) => t.replace(/"(https:\/\/www\.acme\.com\/about)",/, '"$1%22,'),
  "a raw line break inside a long text value": (t) => t.replace("Publishes software.", "Publishes\nsoftware."),
  "a web address turned into a markdown link": (t) => t.replace(/"https:\/\/www\.acme\.com\/about"/, '"[https://www.acme.com/about](https://www.acme.com/about)"')
};

for (const [name, fn] of Object.entries(damage)) {
  test(`damage: ${name} -> the same data is read`, () => {
    const damaged = fn(pretty);
    assert.notEqual(damaged, pretty, "the damage was applied");
    const got = read(damaged);
    if (name === "a raw line break inside a long text value") {
      assert.equal(got, baseline.replace("Publishes software.", "Publishes software."), "joined with a space");
    } else {
      assert.equal(got, baseline);
    }
  });
}

test("damage: several at once", () => {
  const damaged = "Sure!\n```json\n" + damage["trailing commas before } and ]"](damage["a web address that lost its closing quote (%22)"](pretty)) + "\n```\nDone.";
  assert.equal(read(damaged), baseline);
});
