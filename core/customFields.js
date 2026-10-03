"use strict";

/*
 * Taught ("custom") field definitions: RTS fields the researcher mapped
 * from inside the extension instead of waiting for a new build. Stored in
 * chrome.storage.local, validated here, and surfaced everywhere a built-in
 * field is: the Rovo prompt, JSON validation, the preview, and publishing.
 *
 * A definition is a list of `fields` (one field named "value" for a
 * "single" definition; N named sub-fields for a "record" definition that is
 * added with an Add button), an optional addButton, and a saveButton.
 * A single field that lives inside a popup also has an openButton (the
 * button that opens the popup) and, optionally, a closeButton. If the popup
 * is a separate browser window the definition also has `window` (buttons to
 * press before Save); a list in such a window names its row with `rowBy`.
 *
 * In the Rovo JSON a definition lives under the top-level "custom" object:
 *   single: custom.<key> = { value, action, source }
 *   record: custom.<key> = [ { <fieldKey>..., action, source } ]
 */
(() => {
  const STORAGE_KEY = "sxrts_custom_fields";
  const KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,39}$/;
  const TEXT_PATTERN = /^[^<>&"'`\\]{1,120}$/;
  const ACTIONS = ["addIfMissing", "updateIfBlank", "replaceAfterConfirmation", "skip"];
  const KINDS = ["single", "record"];
  const FIELD_KINDS = ["text", "select"];

  let cached = [];

  function normalize(value) {
    return value === null || value === undefined ? "" : String(value).trim().replace(/\s+/g, " ").toLowerCase();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateSelectors(owner, selectors, errors) {
    if (!Array.isArray(selectors) || !selectors.length || selectors.some((s) => typeof s !== "string" || !s.trim())) {
      errors.push(`${owner}: at least one CSS selector is required.`);
    }
  }

  // Popup buttons may be identified by selectors or by their visible text.
  function validateOptionalButton(owner, button, errors) {
    if (button === undefined || button === null) return;
    const hasSelectors = Array.isArray(button.selectors) && button.selectors.some((s) => typeof s === "string" && s.trim());
    const hasText = typeof button.text === "string" && button.text.trim() !== "";
    if (!hasSelectors && !hasText) errors.push(`${owner}: could not be identified on the page. Pick it again.`);
  }

  function validateDefinition(def) {
    const errors = [];
    if (!isPlainObject(def)) return ["The field definition must be an object."];
    if (!KEY_PATTERN.test(def.key || "")) errors.push("The JSON key must start with a lowercase letter and use only letters and digits (e.g. foundedYear).");
    if (!TEXT_PATTERN.test(def.label || "")) errors.push('The field name is required and must not contain < > & quotes or backslashes.');
    if (def.description && !TEXT_PATTERN.test(def.description)) errors.push('The description must not contain < > & quotes or backslashes (max 120 characters).');
    if (!KINDS.includes(def.kind)) errors.push('Kind must be "single" or "record".');
    if (!Array.isArray(def.fields) || !def.fields.length) {
      errors.push("At least one field must be picked on the page.");
    } else {
      if (def.kind === "single" && (def.fields.length !== 1 || def.fields[0].key !== "value")) {
        errors.push('A single field must have exactly one field named "value".');
      }
      const seen = new Set();
      for (const field of def.fields) {
        if (!KEY_PATTERN.test(field?.key || "") || ["action", "source", "confidence"].includes(field.key)) {
          errors.push(`Sub-field key "${field?.key ?? ""}" is invalid or reserved.`);
          continue;
        }
        if (seen.has(field.key)) errors.push(`Sub-field key "${field.key}" is used twice.`);
        seen.add(field.key);
        if (!FIELD_KINDS.includes(field.kind)) errors.push(`Sub-field "${field.key}" must be a text box or a native dropdown.`);
        validateSelectors(`Sub-field "${field.key}"`, field.selectors, errors);
        if (field.kind === "select" && (!Array.isArray(field.options) || !field.options.length)) {
          errors.push(`Dropdown "${field.key}" has no options.`);
        }
      }
    }
    // A list in a separate window has no Add button: each row has its own
    // button that opens the window, and the row is found by rowBy.
    if (def.kind === "record" && !def.window) {
      validateSelectors("The Add button", def.addButton?.selectors, errors);
    }
    validateSelectors("The Save button", def.saveButton?.selectors, errors);
    if (def.openButton !== undefined && def.openButton !== null) {
      if (def.kind !== "single" && !def.window) errors.push("Only a single field can sit inside a popup.");
      validateOptionalButton("The button that opens the popup", def.openButton, errors);
      validateOptionalButton("The popup's Close button", def.closeButton, errors);
    } else if (def.closeButton) {
      errors.push("A Close button only makes sense for a field inside a popup.");
    }
    if (def.window !== undefined && def.window !== null) {
      if (!isPlainObject(def.window)) errors.push("The popup window settings are invalid.");
      if (!def.openButton) errors.push("A field in a separate window needs the button that opens it.");
      if (def.kind === "record" && (!def.rowBy?.outKey || typeof def.rowBy.rowSelector !== "string" || !def.rowBy.rowSelector || !def.binds)) {
        errors.push("The rows of this list could not be recognised. Pick the opening button again.");
      }
      for (const button of def.window?.preSave ?? []) validateOptionalButton("A button pressed before Save", button, errors);
    }
    if (def.binds !== undefined) errors.push(...validateBinds(def));
    return errors;
  }

  // A "bound" definition fills an RTS field from an agent-report field (see
  // core/outputFields.js) instead of from the optional "custom" JSON object.
  function validateBinds(def) {
    const field = globalThis.SXRTS.outputFields?.get(def.binds?.path);
    if (!field) return ["The report field this mapping fills is not recognised."];
    const errors = [];
    if (def.kind !== (field.kind === "single" ? "single" : "record")) errors.push(`${field.label} must be mapped as a ${field.kind === "single" ? "single field" : "repeatable record"}.`);
    const outKeys = field.keys.map((k) => k.key);
    for (const f of def.fields || []) {
      if (!outKeys.includes(def.binds.map?.[f.key])) errors.push(`Pick which ${field.label} value goes into "${f.key}".`);
    }
    return errors;
  }

  async function load() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      cached = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY].filter((d) => validateDefinition(d).length === 0) : [];
    } catch {
      cached = [];
    }
    return cached;
  }

  function getCached() {
    return cached;
  }

  function getDefinition(key) {
    return cached.find((def) => def.key === key) || null;
  }

  const getBoundDef = (path) => cached.find((def) => def.binds?.path === path) || null;
  const isBound = (def) => Boolean(def?.binds);

  // The definition-shaped record for a bound field: each RTS sub-field takes
  // the report value it was mapped to.
  function toDefRecord(def, outRecord) {
    const record = { action: outRecord?.action || "addIfMissing", source: outRecord?.source ?? null };
    // Names the row whose window is filled (for example the network).
    if (def.rowBy) record.__row = outRecord?.[def.rowBy.outKey] ?? null;
    for (const field of def.fields) {
      const outKey = def.binds.map[field.key];
      const value = outRecord?.[outKey];
      record[field.key] = value === undefined ? null : value;
    }
    return record;
  }

  async function persist(next) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    cached = next;
  }

  async function saveDefinition(def) {
    const errors = validateDefinition(def);
    if (errors.length) throw new Error(errors.join(" "));
    const reserved = ["nameVariations", "emailDefaultStructure", "websiteAddresses"];
    if (reserved.includes(def.key)) throw new Error(`"${def.key}" is already a built-in field name.`);
    const record = { ...def, updatedAt: new Date().toISOString() };
    // One mapping per report field: saving again replaces the earlier one.
    await persist([...cached.filter((existing) => existing.key !== def.key && !(def.binds && existing.binds?.path === def.binds.path)), record]);
    return record;
  }

  async function removeDefinition(key) {
    await persist(cached.filter((def) => def.key !== key));
  }

  function jsonPathFor(def) {
    return `custom.${def.key}`;
  }

  function defForJsonPath(jsonPath) {
    if (typeof jsonPath === "string" && jsonPath.startsWith("custom.")) return getDefinition(jsonPath.slice("custom.".length));
    return getBoundDef(jsonPath);
  }

  function findOption(field, value) {
    const target = normalize(value);
    return (field.options || []).find((option) => normalize(option.label) === target || normalize(option.value) === target) || null;
  }

  // Returns an error string, or null when the record is acceptable. Used both
  // for the initial paste and for re-validating a manual edit in the preview.
  function validateRecord(def, record) {
    if (!isPlainObject(record)) return `custom.${def.key}: each entry must be an object.`;
    if (!ACTIONS.includes(record.action)) return `custom.${def.key}.action must be one of: ${ACTIONS.join(", ")}.`;
    if (record.source !== undefined && record.source !== null && !/^https:\/\/\S+$/.test(String(record.source))) {
      return `custom.${def.key}.source must be a full https:// URL or null.`;
    }
    for (const field of def.fields) {
      const value = record[field.key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string" && typeof value !== "number") return `custom.${def.key}.${field.key} must be text or null.`;
      if (field.kind === "select" && !findOption(field, value)) {
        return `custom.${def.key}.${field.key}: "${value}" is not a supported value. Supported: ${field.options.map((o) => o.label).join(", ")}.`;
      }
    }
    return null;
  }

  function normalizeRecord(def, record) {
    const out = { ...record };
    for (const field of def.fields) {
      const value = record[field.key];
      if (value === undefined || value === null || value === "") {
        out[field.key] = null;
      } else if (field.kind === "select") {
        out[field.key] = findOption(field, value).label;
      } else {
        out[field.key] = String(value).trim();
      }
    }
    return out;
  }

  function hasAnyValue(def, record) {
    return def.fields.some((field) => record[field.key] !== null && record[field.key] !== undefined && record[field.key] !== "");
  }

  // Validates the pasted top-level "custom" object against the taught
  // definitions. Unknown keys are warnings (ignored), not errors, matching
  // how the schema treats unrecognised built-in keys.
  function validatePayload(custom, allDefs = cached) {
    const defs = allDefs.filter((def) => !def.binds);
    const errors = [];
    const warnings = [];
    const value = {};
    if (custom === undefined || custom === null) return { errors, warnings, value };
    if (!isPlainObject(custom)) return { errors: ['"custom" must be an object.'], warnings, value };

    for (const [key, raw] of Object.entries(custom)) {
      const def = defs.find((d) => d.key === key);
      if (!def) {
        warnings.push(`custom.${key} is not a taught field on this browser and was ignored.`);
        continue;
      }
      if (raw === null) continue;
      if (def.kind === "single") {
        if (!isPlainObject(raw)) { errors.push(`custom.${key} must be an object with value/action/source.`); continue; }
        const error = validateRecord(def, raw);
        if (error) { errors.push(error); continue; }
        value[key] = normalizeRecord(def, raw);
      } else {
        if (!Array.isArray(raw)) { errors.push(`custom.${key} must be an array of records.`); continue; }
        const records = [];
        raw.forEach((entry, index) => {
          const error = validateRecord(def, entry);
          if (error) errors.push(`[${index}] ${error}`);
          else records.push(normalizeRecord(def, entry));
        });
        value[key] = records;
      }
    }
    return { errors, warnings, value };
  }

  // For the preview editor: the dropdown options of a custom record's field.
  function optionsFor(jsonPath, fieldKey) {
    const def = defForJsonPath(jsonPath);
    const sub = def?.binds ? Object.entries(def.binds.map).find(([, outKey]) => outKey === fieldKey)?.[0] : fieldKey;
    const field = def?.fields.find((f) => f.key === sub);
    if (!field || field.kind !== "select") return null;
    return { values: field.options.map((o) => o.label), allowBlank: true };
  }

  function exampleFor(field) {
    return field.kind === "select" ? "exact value from the list below, or null" : "string|null";
  }

  // Pieces the prompt builder splices in: the JSON shape of "custom", the
  // per-field description lines, and the supported-values catalogs.
  function promptParts(allDefs = cached) {
    const defs = allDefs.filter((def) => !def.binds);
    if (!defs.length) return null;
    const shape = {};
    const notes = [];
    const catalogs = [];

    for (const def of defs) {
      const common = { action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null" };
      if (def.kind === "single") {
        shape[def.key] = { value: exampleFor(def.fields[0]), ...common };
      } else {
        const record = {};
        for (const field of def.fields) record[field.key] = exampleFor(field);
        shape[def.key] = [{ ...record, ...common }];
      }
      const hints = def.fields.map((f) => (f.description ? `${f.key}: ${f.description}` : null)).filter(Boolean);
      notes.push(`- custom.${def.key} (${def.label})${def.description ? `: ${def.description}` : ""}${def.kind === "record" ? hints.length ? ` — fields: ${hints.join("; ")}` : "" : ""}`);
      for (const field of def.fields) {
        if (field.kind !== "select") continue;
        const path = def.kind === "single" ? `custom.${def.key}.value` : `custom.${def.key}[].${field.key}`;
        catalogs.push(`Supported values (${path}):\n- ${field.options.map((o) => o.label).join("\n- ")}`);
      }
    }
    return { shape, notes, catalogs };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.customFields = {
    ACTIONS, KEY_PATTERN, load, getCached, getDefinition, saveDefinition, removeDefinition,
    validateDefinition, validateRecord, validatePayload, normalizeRecord, hasAnyValue, getBoundDef, isBound, toDefRecord,
    jsonPathFor, defForJsonPath, optionsFor, promptParts, findOption
  };
})();
