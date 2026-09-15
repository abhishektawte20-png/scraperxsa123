"use strict";

/*
 * Evidenced from a live RTS Business Entity > Entity > Name Variations
 * screenshot + copied outerHTML (Protocol DMC Spain, PBID 862926-85):
 * - #addNameVariation opens a new row.
 * - Each row is a native <input class="businessEntityName"> paired with a
 *   native <select class="businessEntityNameType">.
 * - #saveBusinessEntityNameVariation (data-test-id
 *   "business-entity-name-variations-save-btn") saves only this
 *   subsection — the Entity section also has its own separate, unrelated
 *   Save button, which must never be used for this field.
 * - After a successful save, the saved row's input gains the class
 *   "savedNameVariation" and its data-defaultvalue is updated to match
 *   value — that pairing is the saved-value verification signal.
 *
 * The primary Formal Name field (input[name="formalNameVariations"]) also
 * carries the class "businessEntityName" (plus "businessEntityNameMain"),
 * so the row selector below explicitly excludes it — otherwise it would
 * be misread as a variation row and could be overwritten.
 *
 * Not yet evidenced: the exact selector for the "View All Name
 * Variations" expand toggle, so ensureExpanded() falls back to its exact
 * visible text if the row inputs aren't already present in the DOM.
 */
(() => {
  const TYPE_OPTIONS = [
    { code: "FAMILIAR", label: "Familiar Name" },
    { code: "FORMER", label: "Former Name" },
    { code: "LEGAL", label: "Legal Name" },
    { code: "OTHER", label: "Other Name" },
    { code: "NATIVE_FORMAL", label: "Native Formal Name" },
    { code: "NATIVE_FAMILIAR", label: "Native Familiar Name" },
    { code: "NATIVE_FORMER", label: "Native Former Name" },
    { code: "NATIVE_LEGAL", label: "Native Legal Name" },
    { code: "NATIVE_OTHER", label: "Native Other Name" }
  ];

  const ENTRY = {
    key: "businessEntity.nameVariations",
    jsonPath: "businessEntity.nameVariations",
    area: "Business Entity",
    section: "Entity",
    controlKind: "repeatableRecord",
    navigation: {
      expandToggleText: "View All Name Variations",
      candidates: []
    },
    addButton: { candidates: ["#addNameVariation"] },
    form: {
      nameInput: { candidates: [".businessEntityName:not(.businessEntityNameMain)"] },
      typeDropdown: { candidates: [".businessEntityNameType:not([hidden])"], options: TYPE_OPTIONS }
    },
    saveButton: { scopedTo: "Entity > Name Variations", candidates: ["#saveBusinessEntityNameVariation"] },
    verification: { method: "classAndDefaultValueMatch", addedClass: "savedNameVariation" },
    duplicateRule: { normalize: "trim+collapseSpaces+lowercase", matchOn: ["name", "type"] },
    evidenceStatus: "ready",
    required: false
  };

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.registryEntries = globalThis.SXRTS.registryEntries || [];
  globalThis.SXRTS.registryEntries.push(ENTRY);
})();
