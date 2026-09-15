"use strict";

/*
 * Turns validated Rovo JSON into an execution plan: one action per proposed
 * record/value. Any field without a "ready" registry entry is placed
 * straight into the "skipped" state with a reason — it is never silently
 * dropped, and it is never attempted against the live page.
 */
(() => {
  const FIELD_SOURCES = [
    { jsonPath: "businessEntity.nameVariations", kind: "array", get: (d) => d.businessEntity?.nameVariations },
    { jsonPath: "businessEntity.emailDefaultStructure", kind: "envelope", get: (d) => d.businessEntity?.emailDefaultStructure },
    { jsonPath: "businessEntity.websiteAddresses", kind: "array", get: (d) => d.businessEntity?.websiteAddresses },
    { jsonPath: "businessEntity.socialMediaIdentifiers", kind: "array", get: (d) => d.businessEntity?.socialMediaIdentifiers },
    { jsonPath: "businessEntity.researchNotes", kind: "array", get: (d) => d.businessEntity?.researchNotes },
    { jsonPath: "company.startDate", kind: "envelope", get: (d) => d.company?.startDate },
    { jsonPath: "company.briefDescription", kind: "envelope", get: (d) => d.company?.briefDescription },
    { jsonPath: "company.fullDescription", kind: "envelope", get: (d) => d.company?.fullDescription },
    { jsonPath: "company.keywords", kind: "array", get: (d) => d.company?.keywords },
    { jsonPath: "company.searchKeywords", kind: "envelope", get: (d) => d.company?.searchKeywords },
    { jsonPath: "company.industries", kind: "array", get: (d) => d.company?.industries },
    { jsonPath: "company.verticals", kind: "array", get: (d) => d.company?.verticals },
    { jsonPath: "company.employeeHistory", kind: "array", get: (d) => d.company?.employeeHistory },
    { jsonPath: "company.sicCodes", kind: "array", get: (d) => d.company?.sicCodes },
    { jsonPath: "company.naicsCodes", kind: "array", get: (d) => d.company?.naicsCodes },
    { jsonPath: "company.sites", kind: "array", get: (d) => d.company?.sites },
    { jsonPath: "company.management", kind: "array", get: (d) => d.company?.management }
  ];

  function buildExecutionPlan(validated) {
    const registry = globalThis.SXRTS.registry;
    const actions = [];
    let counter = 0;

    for (const source of FIELD_SOURCES) {
      const value = source.get(validated);
      if (value === undefined || value === null) continue;
      const records = source.kind === "array" ? value : [value];
      const registryEntry = registry.getField(source.jsonPath);

      records.forEach((record, index) => {
        if (!record) return;
        if (source.kind === "envelope" && (record.value === null || record.value === undefined)) return;
        if (record.action === "skip") return;

        counter += 1;
        // RTS has exactly one Website Address field; only the first
        // proposed record can ever be written, so every subsequent one is
        // skipped here rather than silently reported as applied later.
        const isWebsiteAddressOverflow = source.jsonPath === "businessEntity.websiteAddresses" && index > 0;
        const skipReason = isWebsiteAddressOverflow
          ? "RTS has only one Website Address field; only the first proposed value can ever be applied."
          : !registryEntry
            ? "No selector registry entry exists for this field yet."
            : registryEntry.evidenceStatus !== "ready"
              ? `Selector evidence for this field is marked "${registryEntry.evidenceStatus}"; automation is blocked until it is verified.`
              : null;

        actions.push({
          actionId: `A${counter}`,
          profileIdentity: validated.profileIdentity,
          area: registryEntry?.area ?? null,
          section: registryEntry?.section ?? null,
          jsonPath: source.jsonPath,
          recordIndex: source.kind === "array" ? index : null,
          operation: record.action,
          currentValue: null,
          // Always the full record (value/action/source/confidence/...),
          // never unwrapped to a bare scalar — every workflow function
          // (e.g. applyEmailDefaultStructureValue) reads .action/.value
          // off this object, so unwrapping it here silently breaks
          // publishing for that field.
          proposedValue: record,
          source: record.source ?? null,
          duplicateStatus: "unknown",
          conflictStatus: "unknown",
          saveScope: registryEntry?.saveButton?.scopedTo ?? null,
          executionStatus: skipReason ? "skipped" : "pending",
          skipReason,
          verificationResult: null
        });
      });
    }

    return actions;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.executionPlan = { buildExecutionPlan, FIELD_SOURCES };
})();
