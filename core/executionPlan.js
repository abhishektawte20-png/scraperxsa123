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
    { jsonPath: "businessEntity.financingStatus", kind: "envelope", get: (d) => d.businessEntity?.financingStatus },
    { jsonPath: "businessEntity.researchStatus", kind: "envelope", get: (d) => d.businessEntity?.researchStatus },
    { jsonPath: "businessEntity.publishStatus", kind: "envelope", get: (d) => d.businessEntity?.publishStatus },
    { jsonPath: "businessEntity.ownershipStatus", kind: "envelope", get: (d) => d.businessEntity?.ownershipStatus },
    { jsonPath: "businessEntity.businessStatus", kind: "envelope", get: (d) => d.businessEntity?.businessStatus },
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

  // The report's address fields that go into ONE site form (Company > Site), and the form box each fills.
  const SITE_EXTRAS = { "extras.address": "address1", "extras.city": "city", "extras.state": "state", "extras.country": "country", "extras.postcode": "zip", "extras.phone": "phone", "extras.fax": "fax", "extras.siteEmail": "email" };
  // The built-in Site is used unless it was unmapped ("Unmap" on a Site card or in Mapped & taught fields).
  // The built-in Verticals workflow (core/workflows/verticals.js) needs no mapping: it finds the section by its words.
  const hasVerticalsWorkflow = () => Boolean(globalThis.SXRTS.workflows?.verticals);
  const hasSiteWorkflow = () => { const w = globalThis.SXRTS.workflows?.companySite; return Boolean(w) && (w.isEnabled ? w.isEnabled() : true); };

  // The monitoring mark: every profile worked with the tool carries it in Research Notes, appended last. It is always
  // added (never removed from the plan, never unticked) and only ever appended to what the notes already say. After the
  // two fixed lines come the sources the report gave for each data point, so the note records where everything came from.
  const ANC_CODE = "AIGEN_SRX_V1_Y";
  // The values the team sets on every profile (Business Entity statuses).
  const FIXED_STATUS = { financing: "Corporation", research: "Does Not Qualify for Meth./Not Act. Tracked", publish: "Publish", ownership: "Privately Held", business: "Generating Revenue" };
  const ALWAYS = new Set(["businessEntity.financingStatus", "businessEntity.researchStatus", "businessEntity.publishStatus", "businessEntity.ownershipStatus", "businessEntity.businessStatus"]);
  const ANC_TEXT = `${ANC_CODE}\nUsed ScraperX UI Automation Tool for Research`;

  // Every record of the report that carries a source link, by field. Links are numbered once, in the order met.
  function collectSources(validated) {
    const friendly = (path) => globalThis.SXRTS.resultsSummary?.friendly?.(path) || path;
    const links = [];
    const byField = new Map();
    const add = (path, url) => {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return;
      const link = url.trim();
      let index = links.indexOf(link);
      if (index < 0) { links.push(link); index = links.length - 1; }
      const label = friendly(path);
      const nums = byField.get(label) ?? [];
      if (!nums.includes(index + 1)) nums.push(index + 1);
      byField.set(label, nums);
    };
    for (const source of FIELD_SOURCES) {
      if (source.jsonPath === "businessEntity.researchNotes") continue;
      const value = source.get(validated);
      if (value === undefined || value === null) continue;
      for (const record of (source.kind === "array" ? value : [value])) if (record && record.action !== "skip") add(source.jsonPath, record.source);
    }
    for (const field of (globalThis.SXRTS.outputFields?.FIELDS ?? []).filter((f) => f.path.startsWith("extras."))) {
      for (const record of globalThis.SXRTS.outputFields.recordsFor(validated, field.path)) if (record && record.action !== "skip") add(field.path, record.source);
    }
    return { links, byField };
  }

  function ancNote(validated) {
    const { links, byField } = collectSources(validated);
    if (!links.length) return ANC_TEXT;
    return [ANC_TEXT, "Sources:", ...links.map((url, i) => `[${i + 1}] ${url}`), ...Array.from(byField, ([label, nums]) => `${label}: ${nums.map((n) => `[${n}]`).join(" ")}`)].join("\n");
  }
  const isAncNote = (text) => typeof text === "string" && text.startsWith(ANC_CODE);

  function buildExecutionPlan(validated) {
    const registry = globalThis.SXRTS.registry;
    const actions = [];
    let counter = 0;

    // The full description in RTS starts with the brief description (brief first, then the full one). Done once; a full
    // description that already starts with the brief one is left alone. The brief description field itself is untouched.
    const briefText = typeof validated.company?.briefDescription?.value === "string" ? validated.company.briefDescription.value.trim() : "";
    const fullRecord = validated.company?.fullDescription;
    if (briefText && typeof fullRecord?.value === "string" && fullRecord.value.trim() && !fullRecord.value.trim().toLowerCase().startsWith(briefText.toLowerCase())) {
      fullRecord.value = `${briefText} ${fullRecord.value.trim()}`;
    }

    validated.businessEntity = validated.businessEntity ?? {};

    // The statuses every profile gets, whatever the agent said (the team's rule): they do not come from the prompt.
    const be = validated.businessEntity;
    be.financingStatus = { value: FIXED_STATUS.financing, action: "replaceAfterConfirmation", source: null };
    be.researchStatus = { value: FIXED_STATUS.research, action: "replaceAfterConfirmation", source: null };
    be.publishStatus = { value: FIXED_STATUS.publish, action: "replaceAfterConfirmation", source: null };
    const history = globalThis.SXRTS.workflows?.statusHistory;
    const startRecord = globalThis.SXRTS.outputFields?.recordsFor?.(validated, "extras.startDate")?.[0];
    const startText = (typeof startRecord?.value === "string" && startRecord.value) || (typeof validated.company?.startDate?.value === "string" ? validated.company.startDate.value : "");
    const startDate = history?.toMdy ? history.toMdy(startText) : null;
    if (startDate) be.ownershipStatus = { value: FIXED_STATUS.ownership, date: startDate, action: "replaceAfterConfirmation", source: null };
    else delete be.ownershipStatus;
    be.businessStatus = { value: FIXED_STATUS.business, date: history?.todayMdy ? history.todayMdy() : null, action: "replaceAfterConfirmation", source: null };
    if (!be.businessStatus.date) delete be.businessStatus;
    const notes = Array.isArray(validated.businessEntity.researchNotes) ? validated.businessEntity.researchNotes : [];
    if (!notes.some((note) => isAncNote(note?.text))) {
      validated.businessEntity.researchNotes = [...notes, { text: ancNote(validated), action: "addIfMissing", source: null }];
    }

    for (const source of FIELD_SOURCES) {
      const value = source.get(validated);
      if (value === undefined || value === null) continue;
      const records = source.kind === "array" ? value : [value];
      const registryEntry = registry.getField(source.jsonPath);
      // A field the researcher mapped with "Map this field" becomes runnable
      // (native workflows always win over a mapping).
      const bound = (registryEntry?.evidenceStatus === "ready" || (source.jsonPath === "company.sites" && hasSiteWorkflow())) ? null : globalThis.SXRTS.customFields?.getBoundDef(source.jsonPath);

      records.forEach((record, index) => {
        if (!record) return;
        if (source.kind === "envelope" && (record.value === null || record.value === undefined)) return;
        if (record.action === "skip") return;

        counter += 1;
        // RTS has exactly one Website Address field; only the first
        // proposed record can ever be written, so every subsequent one is
        // skipped here rather than silently reported as applied later.
        const isWebsiteAddressOverflow = source.jsonPath === "businessEntity.websiteAddresses" && index > 0;
        const nativeSite = source.jsonPath === "company.sites" && hasSiteWorkflow();
        const nativeVerticals = source.jsonPath === "company.verticals" && hasVerticalsWorkflow();
        const skipReason = (bound || nativeSite || nativeVerticals) ? null : isWebsiteAddressOverflow
          ? "RTS has only one Website Address field; only the first proposed value can ever be applied."
          : !registryEntry
            ? "No selector registry entry exists for this field yet."
            : registryEntry.evidenceStatus !== "ready"
              ? `Selector evidence for this field is marked "${registryEntry.evidenceStatus}"; automation is blocked until it is verified.`
              : null;

        actions.push({
          actionId: `A${counter}`,
          verticalGroup: nativeVerticals || undefined,
          mandatory: isAncNote(record?.text) || undefined,
          always: ALWAYS.has(source.jsonPath) || undefined,
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

    if (!be.ownershipStatus) {
      counter += 1;
      actions.push({
        actionId: `A${counter}`, profileIdentity: validated.profileIdentity, area: "Business Entity", section: "Ownership Status History", jsonPath: "businessEntity.ownershipStatus", recordIndex: null,
        operation: "skip", currentValue: null, proposedValue: { value: FIXED_STATUS.ownership, date: null, action: "skip" }, source: null, duplicateStatus: "unknown", conflictStatus: "unknown",
        saveScope: null, executionStatus: "skipped", skipReason: "No start date was found in the report, so no ownership status row is added.", verificationResult: null, always: true
      });
    }

    // Report fields with no native workflow (address, start date, ...): shown
    // as cards so each can be mapped, and runnable once it is.
    for (const field of (globalThis.SXRTS.outputFields?.FIELDS ?? []).filter((f) => f.path.startsWith("extras."))) {
      const siteGroup = Boolean(SITE_EXTRAS[field.path]) && hasSiteWorkflow();
      const verticalGroup = field.path === "extras.verticals" && hasVerticalsWorkflow();
      const bound = (siteGroup || verticalGroup) ? null : globalThis.SXRTS.customFields?.getBoundDef(field.path);
      globalThis.SXRTS.outputFields.recordsFor(validated, field.path).forEach((record, index) => {
        if (record.action === "skip") return;
        counter += 1;
        actions.push({
          siteGroup: siteGroup || undefined,
          verticalGroup: verticalGroup || undefined,
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
          executionStatus: (bound || siteGroup || verticalGroup) ? "pending" : "skipped",
          skipReason: (bound || siteGroup || verticalGroup) ? null : "No selector registry entry exists for this field yet.",
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
  globalThis.SXRTS.executionPlan = { buildExecutionPlan, FIELD_SOURCES, SITE_EXTRAS, ANC_CODE, ANC_TEXT, FIXED_STATUS, ancNote, collectSources };
})();
