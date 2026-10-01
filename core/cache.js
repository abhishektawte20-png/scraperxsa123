"use strict";

/*
 * Profile-scoped cache using chrome.storage.local. Never mixes profiles:
 * every read/write is keyed by a profileKey derived from the strongest
 * available identifier (pbId > entityId > normalized domain). Stores only
 * the execution plan and its outcomes, not raw company research text.
 */
(() => {
  const STORAGE_PREFIX = "sxrts_profile:";
  const LAST_JSON_PREFIX = "sxrts_lastjson:";

  function profileKeyFor(identity) {
    const key = identity.pbId || identity.entityId || (globalThis.SXRTS?.identityLock?.normalizeDomain(identity.domain));
    if (!key) throw new Error("Cannot build a cache key: profile identity has no pbId, entityId, or domain.");
    return `${STORAGE_PREFIX}${key}`;
  }

  async function computeInputHash(canonicalObject) {
    const stable = JSON.stringify(canonicalObject, Object.keys(canonicalObject).sort());
    const bytes = new TextEncoder().encode(stable);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function getProfileCache(identity) {
    const key = profileKeyFor(identity);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function setProfileCache(identity, record) {
    const key = profileKeyFor(identity);
    const payload = { ...record, lastUpdated: new Date().toISOString() };
    await chrome.storage.local.set({ [key]: payload });
    return payload;
  }

  async function clearProfileCache(identity) {
    const key = profileKeyFor(identity);
    await chrome.storage.local.remove(key);
  }

  // The last pasted (validated) Rovo JSON text for a profile, so it can be
  // restored later without pasting again. Stored separately from the plan
  // cache so clearing or rewriting one never touches the other.
  function lastJsonKeyFor(identity) {
    return profileKeyFor(identity).replace(STORAGE_PREFIX, LAST_JSON_PREFIX);
  }

  async function getLastJson(identity) {
    const key = lastJsonKeyFor(identity);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function setLastJson(identity, text) {
    const key = lastJsonKeyFor(identity);
    const payload = { text, savedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [key]: payload });
    return payload;
  }

  async function clearLastJson(identity) {
    await chrome.storage.local.remove(lastJsonKeyFor(identity));
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.cache = { profileKeyFor, computeInputHash, getProfileCache, setProfileCache, clearProfileCache, getLastJson, setLastJson, clearLastJson };
})();
