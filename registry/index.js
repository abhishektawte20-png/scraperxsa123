"use strict";

/*
 * Aggregates whatever per-field registry files (registry/<area>.<field>.js)
 * have already registered themselves into globalThis.SXRTS.registryEntries.
 * Load this file after all per-field registry files.
 */
(() => {
  function all() {
    return globalThis.SXRTS.registryEntries || [];
  }

  function getField(key) {
    return all().find((entry) => entry.key === key) || null;
  }

  function isReady(key) {
    return getField(key)?.evidenceStatus === "ready";
  }

  function listByArea(area) {
    return all().filter((entry) => entry.area === area);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.registry = { getField, isReady, listByArea };
})();
