// DOM-level tests for identityLock.readRtsIdentityFromPage(), run against
// a jsdom reconstruction of the evidenced RTS identity elements
// (fixtures/business-entity-identity.html).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(here, "../fixtures/business-entity-identity.html"), "utf8");

import "../core/identityLock.js";

const { identityLock } = globalThis.SXRTS;

function setupDom(bodyHtml = fixtureHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: "https://rts.pitchbook.com/ext/862926-85/BE/BENTITY"
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  return dom;
}

test("reads PBID regardless of the generated class hash suffix", () => {
  setupDom();
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.pbId, "862926-85");
});

test("reads the formal name from the primary field, not a variation row", () => {
  setupDom();
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.formalName, "Protocol DMC Spain");
  assert.equal(identity.companyName, "Protocol DMC Spain");
});

test("falls back to deriving domain from Website Address when Domain is blank", () => {
  setupDom();
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.domain, "dmcspain.com");
});

test("prefers the Domain field over Website Address when both are populated", () => {
  setupDom(fixtureHtml.replace('value="" class="input" id="domainValue"', 'value="explicit-domain.com" class="input" id="domainValue"'));
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.domain, "explicit-domain.com");
});

test("tolerates a markdown-linkified Website Address value", () => {
  setupDom(fixtureHtml.replace('value="www.dmcspain.com"', 'value="[www.dmcspain.com](https://www.dmcspain.com)"'));
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.domain, "dmcspain.com");
});

test("captures the current RTS URL", () => {
  setupDom();
  const identity = identityLock.readRtsIdentityFromPage();
  assert.equal(identity.sourceRtsUrl, "https://rts.pitchbook.com/ext/862926-85/BE/BENTITY");
});

test("throws a plain (non-NotEvidencedError) error when no identity elements are present", () => {
  setupDom("<div>Some unrelated page</div>");
  assert.throws(() => identityLock.readRtsIdentityFromPage(), (error) => {
    assert.ok(!(error instanceof identityLock.NotEvidencedError));
    assert.match(error.message, /Is a Business Entity record open/);
    return true;
  });
});

test("end to end: compareIdentity matches a Rovo JSON identity against the read RTS identity", () => {
  setupDom();
  const rtsIdentity = identityLock.readRtsIdentityFromPage();
  const jsonIdentity = { pbId: "862926-85", domain: "www.dmcspain.com", companyName: "Protocol DMC Spain" };
  const result = identityLock.compareIdentity(jsonIdentity, rtsIdentity);
  assert.equal(result.status, "match");
});

test("end to end: compareIdentity blocks on a conflicting pbId", () => {
  setupDom();
  const rtsIdentity = identityLock.readRtsIdentityFromPage();
  const jsonIdentity = { pbId: "999999-99", domain: "dmcspain.com" };
  const result = identityLock.compareIdentity(jsonIdentity, rtsIdentity);
  assert.equal(result.status, "mismatch");
});
