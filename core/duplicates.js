"use strict";

/*
 * Generic duplicate-record detection primitive. It only knows how to
 * normalize-and-compare a set of fields on two records; it does not know
 * what "duplicate" means for any specific RTS record type (name variation,
 * SMI, site, management). Per-field duplicate rules for each RTS record
 * type are supplied by that field's registry entry (duplicateRule) once
 * evidenced — see docs/evidence-checklist.md.
 */
(() => {
  function normalizeValue(value) {
    return globalThis.SXRTS.identityLock.normalizeText(value);
  }

  function isDuplicateRecord(existingRecords, candidate, matchOnFields) {
    return existingRecords.some((existing) =>
      matchOnFields.every((field) => normalizeValue(existing[field]) === normalizeValue(candidate[field]))
    );
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.duplicates = { isDuplicateRecord, normalizeValue };
})();
