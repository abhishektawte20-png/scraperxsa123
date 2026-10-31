// RTS wants only the handle on every network: no address, no @, no trailing slash.

import assert from "node:assert/strict";
import { test } from "node:test";

import "../core/rovoContract.js";
import "../core/rovoText.js";
import "../core/schema.js";
import { validOutput } from "./helpers/rovo-sample.mjs";

const toHandle = globalThis.SXRTS.rovoContract.toHandle;

test("a link becomes the handle, on every network", () => {
  const cases = [
    ["Facebook", "https://www.facebook.com/RelianceIndustriesLimited/", "RelianceIndustriesLimited"],
    ["Facebook", "https://facebook.com/lagoonfesttexas?ref=page", "lagoonfesttexas"],
    ["Facebook", "https://www.facebook.com/pages/Some-Name/12345", "Some-Name"],
    ["Facebook", "https://www.facebook.com/profile.php?id=100012345", "100012345"],
    ["Instagram", "https://www.instagram.com/lagoonfesttexas/", "lagoonfesttexas"],
    ["Twitter/X", "https://twitter.com/reliance", "reliance"],
    ["Twitter/X", "https://x.com/@reliance", "reliance"],
    ["LinkedIn", "https://www.linkedin.com/company/reliance-industries-limited/", "reliance-industries-limited"],
    ["LinkedIn", "https://in.linkedin.com/company/reliance-industries-limited/about/", "reliance-industries-limited"],
    ["LinkedIn", "https://www.linkedin.com/school/some-school", "some-school"],
    ["YouTube", "https://www.youtube.com/@RelianceIndustries", "RelianceIndustries"],
    ["YouTube", "https://www.youtube.com/channel/UC123abc", "UC123abc"],
    ["Facebook", "www.facebook.com/abc/", "abc"],
    ["Facebook", "[https://www.facebook.com/abc](https://www.facebook.com/abc)", "abc"]
  ];
  for (const [network, input, want] of cases) assert.equal(toHandle(network, input), want, `${network}: ${input}`);
});

test("a handle that is already a handle is only tidied", () => {
  assert.equal(toHandle("Twitter/X", "@reliance"), "reliance");
  assert.equal(toHandle("Instagram", "lagoonfesttexas/"), "lagoonfesttexas");
  assert.equal(toHandle("LinkedIn", "reliance-industries-limited"), "reliance-industries-limited");
});

test("an unknown network, or a link that does not name a handle, is left alone", () => {
  assert.equal(toHandle("Pinterest", "https://www.pinterest.com/xyz/"), "https://www.pinterest.com/xyz/");
  assert.equal(toHandle("Facebook", "https://www.facebook.com/"), "https://www.facebook.com/");
});

test("the preview rows carry the handle, not the address", () => {
  const out = validOutput();
  const smi = out.social_media_identifiers;
  smi.linkedin.value = "https://www.linkedin.com/company/acme-corp/";
  smi.twitter_x.value = "https://twitter.com/acmecorp";
  smi.facebook.value = "https://www.facebook.com/acmecorp/";
  for (const key of ["linkedin", "twitter_x", "facebook"]) smi[key].source_url = "https://www.acme.com";
  const result = globalThis.SXRTS.schema.validate(JSON.stringify(out), { domain: "acme.com" });
  const rows = result.businessEntity.socialMediaIdentifiers.map((r) => `${r.network}=${r.handleOrUrl}`);
  assert.ok(rows.includes("LinkedIn=acme-corp") && rows.includes("Twitter/X=acmecorp") && rows.includes("Facebook=acmecorp"), rows.join(", "));
  assert.ok(rows.every((r) => !/https?:|@|\//.test(r.split("=")[1])), "no row keeps an address or an @");
});
