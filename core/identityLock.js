"use strict";

/*
 * Profile identity lock. compareIdentity() is a pure function and is fully
 * testable without a browser.
 *
 * readRtsIdentityFromPage() is evidenced from a live Protocol DMC Spain
 * record (PBID 862926-85):
 * - PBID: a <span class="flat-button__caption-<hash>"> containing the text
 *   "PBID: <value>". The trailing class segment looks like a generated
 *   CSS-module hash and is not assumed stable, so this matches on the
 *   stable "flat-button__caption" prefix plus the "PBID:" text pattern,
 *   not the full class name.
 * - Formal name: input[name="formalNameVariations"].
 * - Domain: #domainValue (often blank).
 * - Website Address: #webURL, used as a fallback to derive a domain when
 *   #domainValue is blank. Falls back to Entity ID being unavailable
 *   (no selector evidence for it yet).
 */
(() => {
  class NotEvidencedError extends Error {
    constructor(message) {
      super(message);
      this.name = "NotEvidencedError";
    }
  }

  function normalizeDomain(value) {
    if (!value) return null;
    let text = String(value).trim().toLowerCase();
    text = text.replace(/^https?:\/\//, "").replace(/^www\./, "");
    text = text.replace(/\/.*$/, "");
    return text || null;
  }

  function normalizeText(value) {
    return value === null || value === undefined ? null : String(value).trim().replace(/\s+/g, " ").toLowerCase();
  }

  // Compares the identity block from the parsed Rovo JSON against whatever
  // identity fields could be read from the currently open RTS record.
  // Blocking identifiers (pbId, entityId, domain) must not conflict; a
  // conflict on any one of them blocks the entire application process.
  function compareIdentity(jsonIdentity, rtsIdentity) {
    const reasons = [];
    let hasStrongComparison = false;

    const blockingPairs = [
      ["pbId", jsonIdentity.pbId, rtsIdentity.pbId],
      ["entityId", jsonIdentity.entityId, rtsIdentity.entityId],
      ["domain", normalizeDomain(jsonIdentity.domain), normalizeDomain(rtsIdentity.domain)]
    ];

    for (const [field, jsonValue, rtsValue] of blockingPairs) {
      if (jsonValue && rtsValue) {
        hasStrongComparison = true;
        if (jsonValue !== rtsValue) {
          reasons.push(`${field} mismatch: JSON has "${jsonValue}", RTS shows "${rtsValue}".`);
        }
      }
    }

    if (reasons.length) {
      return { status: "mismatch", reasons };
    }

    if (!hasStrongComparison) {
      return {
        status: "insufficient",
        reasons: ["No shared strong identifier (pbId, entityId, or domain) was available to compare. Application is blocked until one matches."]
      };
    }

    const nameJson = normalizeText(jsonIdentity.companyName || jsonIdentity.formalName);
    const nameRts = normalizeText(rtsIdentity.companyName || rtsIdentity.formalName);
    if (nameJson && nameRts && nameJson !== nameRts) {
      reasons.push(`Company name differs (informational only): JSON has "${jsonIdentity.companyName}", RTS shows "${rtsIdentity.companyName}".`);
    }

    return { status: reasons.length ? "match-with-warnings" : "match", reasons };
  }

  function readPbid() {
    const candidates = document.querySelectorAll('[class*="flat-button__caption"]');
    for (const el of candidates) {
      const match = el.textContent.trim().match(/^PBID:\s*(.+)$/i);
      if (match) return match[1].trim();
    }
    return null;
  }

  function readFormalName() {
    // Try Business Entity tab selector first
    let value = document.querySelector('input[name="formalNameVariations"]')?.value?.trim();
    if (value) return value;

    // Fallback: try Company tab Name field
    value = document.querySelector('input[name="company.name"]')?.value?.trim();
    if (value) return value;

    // Try Formal Name field on Company tab
    value = document.querySelector('input[placeholder*="Formal Name"]')?.value?.trim();
    return value || null;
  }

  function readDomainField() {
    // Try Business Entity tab selector first
    let value = document.querySelector("#domainValue")?.value?.trim();
    if (value) return value;

    // Fallback: try to find domain field elsewhere
    const candidates = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const el of candidates) {
      if (el.name?.toLowerCase().includes('domain') || el.placeholder?.toLowerCase().includes('domain')) {
        return el.value?.trim() || null;
      }
    }
    return null;
  }

  function readWebsiteUrl() {
    // Try Business Entity tab selector first
    let value = document.querySelector("#webURL")?.value?.trim();
    if (value) return value;

    // Fallback: try Company tab website field
    value = document.querySelector('input[name="company.websiteUrl"]')?.value?.trim();
    if (value) return value;

    // Try any field with "website" or "url" in name/placeholder
    const candidates = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const el of candidates) {
      const name = el.name?.toLowerCase() || '';
      const placeholder = el.placeholder?.toLowerCase() || '';
      if ((name.includes('website') || name.includes('url')) && !name.includes('update')) {
        return el.value?.trim() || null;
      }
      if ((placeholder.includes('website') || placeholder.includes('official')) && el.value?.trim()) {
        return el.value?.trim();
      }
    }
    return null;
  }

  // Defends against a value copied through a tool that markdown-linkified
  // a bare URL (e.g. "[www.x.com](https://www.x.com)") in addition to a
  // plain URL/host string.
  function domainFromRawValue(value) {
    if (!value) return null;
    const markdownLink = value.match(/^\[(.*?)\]\((.*?)\)$/);
    const candidate = markdownLink ? markdownLink[2] || markdownLink[1] : value;
    try {
      const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
      return normalizeDomain(url.hostname);
    } catch {
      return normalizeDomain(candidate);
    }
  }

  function readRtsIdentityFromPage() {
    const pbId = readPbid();
    const formalName = readFormalName();
    const domain = normalizeDomain(readDomainField()) || domainFromRawValue(readWebsiteUrl());

    if (!pbId && !domain && !formalName) {
      throw new Error("No RTS Business Entity identity fields (PBID, domain, formal name) were found on this page. Is a Business Entity record open?");
    }

    return {
      pbId,
      entityId: null, // no selector evidence yet
      companyName: formalName,
      formalName,
      domain,
      sourceRtsUrl: globalThis.location?.href ?? null
    };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.identityLock = { compareIdentity, readRtsIdentityFromPage, normalizeDomain, normalizeText, NotEvidencedError };
})();
