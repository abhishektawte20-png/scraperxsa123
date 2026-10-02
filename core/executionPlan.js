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
      // A field the researcher mapped with "Map this field" becomes runnable
      // (native workflows always win over a mapping).
      const bound = registryEntry?.evidenceStatus === "ready" ? null : globalThis.SXRTS.customFields?.getBoundDef(source.jsonPath);

      records.forEach((record, index) => {
        if (!record) return;
        if (source.kind === "envelope" && (record.value === null || record.value === undefined)) return;
        if (record.action === "skip") return;

        counter += 1;
        // RTS has exactly one Website Address field; only the first
        // proposed record can ever be written, so every subsequent one is
        // skipped here rather than silently reported as applied later.
        const isWebsiteAddressOverflow = source.jsonPath === "businessEntity.websiteAddresses" && index > 0;
        const skipReason = bound ? null : isWebsiteAddressOverflow
          ? "RTS has only one Website Address field; only the first proposed value can ever be applied."
          : !registryEntry
            ? "No selector registry entry exists for this field yet."
            : registryEntry.evidenceStatus !== "ready"
              ? `Selector evidence for this field is marked "${registryEntry.evidenceStatus}"; automation is blocked until it is verified.`
              : null;

        actions.push({
          actionId: `A${counter}`,
          profileIdentity: validated.profileIdentity,
          area: bound ? "Mapped field" : (registryEntry?.area ?? null),
          section: bound ? bound.label : (registryEntry?.section ?? null),
          customKey: bound ? bound.key : undefined,
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

    // Report fields with no native workflow (address, start date, ...): shown
    // as cards so each can be mapped, and runnable once it is.
    for (const field of (globalThis.SXRTS.outputFields?.FIELDS ?? []).filter((f) => f.path.startsWith("extras."))) {
      const bound = globalThis.SXRTS.customFields?.getBoundDef(field.path);
      globalThis.SXRTS.outputFields.recordsFor(validated, field.path).forEach((record, index) => {
        if (record.action === "skip") return;
        counter += 1;
        actions.push({
          actionId: `A${counter}`,
          profileIdentity: validated.profileIdentity,
          area: bound ? "Mapped field" : field.area,
          section: bound ? bound.label : field.label,
          customKey: bound ? bound.key : undefined,
          jsonPath: field.path,
          recordIndex: field.kind === "list" ? index : null,
          operation: record.action,
          currentValue: null,
          proposedValue: record,
          source: record.source ?? null,
          duplicateStatus: "unknown",
          conflictStatus: "unknown",
          saveScope: bound?.label ?? null,
          executionStatus: bound ? "pending" : "skipped",
          skipReason: bound ? null : "No selector registry entry exists for this field yet.",
          verificationResult: null
        });
      });
    }

    // Taught fields: validated.custom is already checked against the stored
    // definitions (see SXRTS.customFields.validatePayload).
    for (const def of (globalThis.SXRTS.customFields?.getCached() ?? []).filter((d) => !d.binds)) {
      const value = validated.custom?.[def.key];
      if (value === undefined || value === null) continue;
      const records = def.kind === "record" ? value : [value];
      records.forEach((record, index) => {
        if (!record || record.action === "skip") return;
        if (def.kind === "single" && (record.value === null || record.value === undefined)) return;
        if (def.kind === "record" && !globalThis.SXRTS.customFields.hasAnyValue(def, record)) return;
        counter += 1;
        actions.push({
          actionId: `A${counter}`,
          profileIdentity: validated.profileIdentity,
          area: "Taught field",
          section: def.label,
          customKey: def.key,
          jsonPath: `custom.${def.key}`,
          recordIndex: def.kind === "record" ? index : null,
          operation: record.action,
          currentValue: null,
          proposedValue: record,
          source: record.source ?? null,
          duplicateStatus: "unknown",
          conflictStatus: "unknown",
          saveScope: def.label,
          executionStatus: "pending",
          skipReason: null,
          verificationResult: null
        });
      });
    }

    return actions;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.executionPlan = { buildExecutionPlan, FIELD_SOURCES };
})();
