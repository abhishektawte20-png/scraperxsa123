"use strict";

/*
 * Canonical Rovo -> RTS JSON contract (schema v1.0).
 * This module only checks JSON shape, types, and formats. It never checks a
 * value against a live RTS dropdown catalog — that happens later, per field,
 * in the execution plan builder, against the selector registry.
 */
(() => {
  const SCHEMA_VERSION = "1.0";
  const ACTIONS = new Set(["addIfMissing", "updateIfBlank", "replaceAfterConfirmation", "skip"]);
  const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
  const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

  class SchemaValidationError extends Error {
    constructor(errors) {
      super(errors.join(" "));
      this.name = "SchemaValidationError";
      this.errors = errors;
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isNullableString(value) {
    return value === null || typeof value === "string";
  }

  // Real observed failure: Rovo wrote the literal text "null" (a string)
  // into an emailDefaultStructure value instead of the JSON literal null.
  // isNullableString technically accepts it (it's a valid string), so it
  // passed validation, then the workflow tried to match "null" against a
  // real catalog value, found nothing, and threw `"null" is not a
  // supported Email Default Structure value.` There's exactly one
  // reasonable reading of the string "null" appearing where a nullable
  // string is expected — same class of safe, unambiguous auto-repair as
  // the bare-domain and http:// fixes elsewhere in this file.
  function normalizeNullableString(value) {
    if (typeof value === "string" && value.trim().toLowerCase() === "null") return null;
    return value;
  }

  function isHttpsUrl(value) {
    if (typeof value !== "string") return false;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }

  // Plain (non-secure) URLs show up occasionally too. There's exactly one
  // reasonable reading of one of these — upgrade the scheme — so it's
  // handled the same way as a bare domain: accepted, then normalized.
  function isHttpUrl(value) {
    if (typeof value !== "string") return false;
    try {
      return new URL(value).protocol === "http:";
    } catch {
      return false;
    }
  }

  function upgradeToHttps(value) {
    return value.trim().replace(/^http:\/\//i, "https://");
  }

  // Matches a bare host with an optional single trailing slash (e.g.
  // "example.com" or "example.com/"), tolerant of the common harmless
  // variant researchers and agents both tend to produce.
  function isBareDomainString(value) {
    return typeof value === "string" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\/?$/i.test(value.trim());
  }

  // RTS's "Website Address" field stores a bare host (e.g. "www.dmcspain.com"),
  // not a full https URL, so this accepts any of a bare domain, an https
  // URL, or an http URL (the last two get their scheme normalized below).
  function isWebsiteAddressValue(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const trimmed = value.trim();
    return isHttpsUrl(trimmed) || isHttpUrl(trimmed) || isBareDomainString(trimmed);
  }

  function normalizeWebsiteAddressValue(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return isHttpUrl(trimmed) ? upgradeToHttps(trimmed) : trimmed;
  }

  // A "source" field is meant to be a citation URL, but Rovo repeatedly
  // hands back a bare domain, or a plain http:// URL, instead of a full
  // https:// citation. Both are unambiguous, lossless cases to accept and
  // upgrade — unlike markdown-link corruption, there's only one reasonable
  // interpretation of either as a source.
  function isValidSourceValue(value) {
    return value === null || isHttpsUrl(value) || isHttpUrl(value) || isBareDomainString(value);
  }

  function normalizeSourceValue(value) {
    if (value === null || value === undefined) return null;
    if (isHttpsUrl(value)) return value.trim();
    if (isHttpUrl(value)) return upgradeToHttps(value);
    if (isBareDomainString(value)) return `https://${value.trim()}`;
    return value;
  }

  // Shared descriptor for every repeatable record's "source" field, so
  // the leniency above applies everywhere uniformly instead of being
  // re-implemented (and potentially drifting) at each call site.
  const SOURCE_FIELD = {
    test: isValidSourceValue,
    message: "must be a valid HTTPS or HTTP URL, a bare domain (e.g. www.example.com), or null.",
    normalize: normalizeSourceValue,
    required: false
  };

  function isValidDate(value) {
    return typeof value === "string" && DATE_RE.test(value);
  }

  function isValidConfidence(value) {
    return value === null || (typeof value === "string" && CONFIDENCE_LEVELS.has(value.toLowerCase()));
  }

  function isValidAction(value) {
    return typeof value === "string" && ACTIONS.has(value);
  }

  // path: human-readable location for error/warning messages.
  function pushError(errors, path, message) {
    errors.push(`${path}: ${message}`);
  }

  // Renders the actual offending value into the error message (truncated)
  // so a failure is self-diagnosable without a follow-up round trip.
  function describeValue(value) {
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
    if (text === undefined) text = String(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }

  function checkEnvelope(record, path, errors, { valueCheck, valueLabel, requireAction = true, valueNormalize = (v) => v }) {
    if (!isPlainObject(record)) {
      pushError(errors, path, `must be an object. Received: ${describeValue(record)}`);
      return null;
    }
    const safe = {};
    if (!("value" in record) || !valueCheck(record.value)) {
      pushError(errors, path, `value must be ${valueLabel}. Received: ${describeValue(record.value)}`);
    } else {
      safe.value = valueNormalize(record.value);
    }
    if (requireAction) {
      if (!isValidAction(record.action)) {
        pushError(errors, path, `action must be one of addIfMissing, updateIfBlank, replaceAfterConfirmation, skip. Received: ${describeValue(record.action)}`);
      } else {
        safe.action = record.action;
      }
    }
    if ("source" in record && record.source !== null && !isValidSourceValue(record.source)) {
      pushError(errors, path, `source must be a valid HTTPS URL, a bare domain, or null. Received: ${describeValue(record.source)}`);
    } else {
      safe.source = normalizeSourceValue(record.source ?? null);
    }
    if ("sourceDate" in record && record.sourceDate !== null && !isValidDate(record.sourceDate)) {
      pushError(errors, path, `sourceDate must use MM/DD/YYYY or be null. Received: ${describeValue(record.sourceDate)}`);
    } else if ("sourceDate" in record) {
      safe.sourceDate = record.sourceDate ?? null;
    }
    if ("confidence" in record && !isValidConfidence(record.confidence)) {
      pushError(errors, path, `confidence must be high, medium, low, or null. Received: ${describeValue(record.confidence)}`);
    } else {
      safe.confidence = record.confidence ? record.confidence.toLowerCase() : null;
    }
    return safe;
  }

  function checkRecordArray(value, path, errors, fieldChecks) {
    if (!Array.isArray(value)) {
      pushError(errors, path, `must be an array. Received: ${describeValue(value)}`);
      return [];
    }
    return value.map((record, index) => {
      const recordPath = `${path}[${index}]`;
      if (!isPlainObject(record)) {
        pushError(errors, recordPath, `must be an object. Received: ${describeValue(record)}`);
        return null;
      }
      const safe = {};
      for (const [key, check] of Object.entries(fieldChecks)) {
        const required = check.required !== false;
        if (!(key in record)) {
          if (required) pushError(errors, `${recordPath}.${key}`, "is required.");
          safe[key] = null;
          continue;
        }
        const fieldValue = record[key];
        if (!check.test(fieldValue)) {
          pushError(errors, `${recordPath}.${key}`, `${check.message} Received: ${describeValue(fieldValue)}`);
          continue;
        }
        safe[key] = check.normalize ? check.normalize(fieldValue) : fieldValue;
      }
      return safe;
    }).filter(Boolean);
  }

  const nameVariationFields = {
    name: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    type: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string (exact catalog match is checked at execution time)." },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD,
    sourceDate: { test: (v) => v === null || isValidDate(v), message: "must be MM/DD/YYYY or null.", required: false },
    confidence: { test: isValidConfidence, message: "must be high, medium, low, or null.", required: false }
  };

  const socialMediaFields = {
    network: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    handleOrUrl: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD,
    confidence: { test: isValidConfidence, message: "must be high, medium, low, or null.", required: false }
  };

  const researchNoteFields = {
    text: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const keywordFields = {
    value: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    action: { test: isValidAction, message: "must be a supported action." }
  };

  const industryFields = {
    sector: { test: (v) => v === null || typeof v === "string", message: "must be a string or null." },
    group: { test: (v) => v === null || typeof v === "string", message: "must be a string or null." },
    code: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    isPrimary: { test: (v) => typeof v === "boolean" || v === null, message: "must be a boolean or null.", required: false },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const verticalFields = {
    value: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const employeeHistoryFields = {
    count: { test: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0, message: "must be a non-negative number." },
    asOfDate: { test: (v) => v === null || isValidDate(v), message: "must be MM/DD/YYYY or null.", required: false },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const codeFields = {
    code: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    action: { test: isValidAction, message: "must be a supported action." }
  };

  const SIC_CLASSIFICATION_SOURCES = new Set(["Morningstar", "PitchBook", "SEC"]);
  // Distinct from the generic "source" (provenance URL) already on every
  // record: this is RTS's own SIC "Source" dropdown (who classified it).
  const sicCodeFields = {
    code: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    classificationSource: { test: (v) => v === null || SIC_CLASSIFICATION_SOURCES.has(v), message: "must be Morningstar, PitchBook, SEC, or null.", required: false },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const siteFields = {
    siteName: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    siteType: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    address1: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    address2: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    city: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    state: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    country: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    zip: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    phone: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    fax: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    email: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    status: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  const managementFields = {
    firstName: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    lastName: { test: (v) => typeof v === "string" && v.trim().length > 0, message: "must be a non-empty string." },
    title: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    startDate: { test: (v) => v === null || isValidDate(v), message: "must be MM/DD/YYYY or null.", required: false },
    endDate: { test: (v) => v === null || isValidDate(v), message: "must be MM/DD/YYYY or null.", required: false },
    status: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    existingPersonPbId: { test: (v) => v === null || typeof v === "string", message: "must be a string or null.", required: false },
    action: { test: isValidAction, message: "must be a supported action." },
    source: SOURCE_FIELD
  };

  // Markdown auto-linkification (e.g. a chat UI turning a bare URL into
  // "[text](url)" before it's copied out) can eat trailing JSON
  // punctuation unpredictably. Rather than guess how to repair it — which
  // risks silently producing a wrong or duplicated value — this fails
  // fast with a specific, actionable message.
  function detectMarkdownLinkCorruption(text) {
    if (/\]\(https?:\/\/[^)]*\)/.test(text)) {
      throw new SchemaValidationError([
        "The pasted text contains markdown link syntax (e.g. \"[text](https://...)\") inside what should be raw JSON. " +
        "This usually happens when copying from a chat UI that auto-linkifies URLs, and it can silently corrupt values. " +
        "Please re-copy the raw JSON text (e.g. a \"copy raw\" / \"view source\" option, or paste into a plain-text editor first) and try again."
      ]);
    }
  }

  function parseRawJson(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new SchemaValidationError(["Paste the ScraperX Rovo JSON response first."]);
    }
    detectMarkdownLinkCorruption(raw);
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new SchemaValidationError(["No JSON object was found in the pasted response."]);
    }
    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch (error) {
      throw new SchemaValidationError([`The pasted response is not valid JSON: ${error.message}`]);
    }
    if (!isPlainObject(parsed)) {
      throw new SchemaValidationError(["The response must be one JSON object."]);
    }
    return parsed;
  }

  function validateProfileIdentity(value, errors) {
    if (!isPlainObject(value)) {
      pushError(errors, "profileIdentity", "is required and must be an object.");
      return null;
    }
    const safe = {};
    for (const key of ["companyName", "formalName", "domain", "pbId", "entityId", "sourceRtsUrl"]) {
      if (key in value && !isNullableString(value[key])) {
        pushError(errors, `profileIdentity.${key}`, "must be a string or null.");
      } else {
        safe[key] = normalizeNullableString(value[key] ?? null);
      }
    }
    if (!safe.companyName) {
      pushError(errors, "profileIdentity.companyName", "is required.");
    }
    if (!safe.pbId && !safe.entityId && !safe.domain) {
      pushError(errors, "profileIdentity", "must include at least one of pbId, entityId, or domain to support the identity lock.");
    }
    return safe;
  }

  function validateBusinessEntity(value, errors, warnings) {
    if (value === undefined) return undefined;
    if (!isPlainObject(value)) {
      pushError(errors, "businessEntity", "must be an object.");
      return null;
    }
    const safe = {};
    const known = new Set(["nameVariations", "emailDefaultStructure", "websiteAddresses", "socialMediaIdentifiers", "researchNotes"]);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) warnings.push(`businessEntity.${key} is not a recognized field and was ignored.`);
    }
    if ("nameVariations" in value) {
      safe.nameVariations = checkRecordArray(value.nameVariations, "businessEntity.nameVariations", errors, nameVariationFields);
    }
    // A whole envelope can legitimately arrive as a bare `null` (Rovo
    // opting out of the field entirely) rather than the nested
    // {value: null, action: "skip"} shape — treated the same as the key
    // being absent, not as a shape error, since both mean "nothing to
    // propose here."
    if ("emailDefaultStructure" in value && value.emailDefaultStructure !== null) {
      safe.emailDefaultStructure = checkEnvelope(value.emailDefaultStructure, "businessEntity.emailDefaultStructure", errors, {
        valueCheck: isNullableString, valueLabel: "a string or null", valueNormalize: normalizeNullableString
      });
    }
    if ("websiteAddresses" in value) {
      // RTS has exactly one Website Address field; the workflow uses the
      // first array entry and reports a warning for any additional ones.
      safe.websiteAddresses = checkRecordArray(value.websiteAddresses, "businessEntity.websiteAddresses", errors, {
        value: { test: isWebsiteAddressValue, message: "must be a valid URL or bare domain (e.g. www.example.com).", normalize: normalizeWebsiteAddressValue },
        action: { test: isValidAction, message: "must be a supported action." },
        source: SOURCE_FIELD,
        confidence: { test: isValidConfidence, message: "must be high, medium, low, or null.", required: false }
      });
    }
    if ("socialMediaIdentifiers" in value) {
      safe.socialMediaIdentifiers = checkRecordArray(value.socialMediaIdentifiers, "businessEntity.socialMediaIdentifiers", errors, socialMediaFields);
    }
    if ("researchNotes" in value) {
      safe.researchNotes = checkRecordArray(value.researchNotes, "businessEntity.researchNotes", errors, researchNoteFields);
    }
    return safe;
  }

  function validateCompany(value, errors, warnings) {
    if (value === undefined) return undefined;
    if (!isPlainObject(value)) {
      pushError(errors, "company", "must be an object.");
      return null;
    }
    const safe = {};
    const known = new Set([
      "startDate", "briefDescription", "fullDescription", "keywords", "searchKeywords", "industries", "verticals",
      "employeeHistory", "sicCodes", "naicsCodes", "sites", "management"
    ]);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) warnings.push(`company.${key} is not a recognized field and was ignored.`);
    }
    // See the matching comment in validateBusinessEntity: a bare `null`
    // for a whole envelope means "nothing to propose," same as an absent
    // key, not a shape error.
    if ("startDate" in value && value.startDate !== null) {
      safe.startDate = checkEnvelope(value.startDate, "company.startDate", errors, { valueCheck: (v) => v === null || isValidDate(v), valueLabel: "MM/DD/YYYY or null" });
    }
    if ("briefDescription" in value && value.briefDescription !== null) {
      safe.briefDescription = checkEnvelope(value.briefDescription, "company.briefDescription", errors, { valueCheck: isNullableString, valueLabel: "a string or null", valueNormalize: normalizeNullableString });
    }
    if ("fullDescription" in value && value.fullDescription !== null) {
      safe.fullDescription = checkEnvelope(value.fullDescription, "company.fullDescription", errors, { valueCheck: isNullableString, valueLabel: "a string or null", valueNormalize: normalizeNullableString });
    }
    if ("keywords" in value) {
      safe.keywords = checkRecordArray(value.keywords, "company.keywords", errors, keywordFields);
    }
    if ("searchKeywords" in value && value.searchKeywords !== null) {
      // A single free-text field in RTS, not a repeatable tag list like keywords.
      safe.searchKeywords = checkEnvelope(value.searchKeywords, "company.searchKeywords", errors, { valueCheck: isNullableString, valueLabel: "a string or null", valueNormalize: normalizeNullableString });
    }
    if ("industries" in value) {
      safe.industries = checkRecordArray(value.industries, "company.industries", errors, industryFields);
    }
    if ("verticals" in value) {
      safe.verticals = checkRecordArray(value.verticals, "company.verticals", errors, verticalFields);
    }
    if ("employeeHistory" in value) {
      safe.employeeHistory = checkRecordArray(value.employeeHistory, "company.employeeHistory", errors, employeeHistoryFields);
    }
    if ("sicCodes" in value) {
      safe.sicCodes = checkRecordArray(value.sicCodes, "company.sicCodes", errors, sicCodeFields);
    }
    if ("naicsCodes" in value) {
      safe.naicsCodes = checkRecordArray(value.naicsCodes, "company.naicsCodes", errors, codeFields);
    }
    if ("sites" in value) {
      safe.sites = checkRecordArray(value.sites, "company.sites", errors, siteFields);
    }
    if ("management" in value) {
      safe.management = checkRecordArray(value.management, "company.management", errors, managementFields);
    }
    return safe;
  }

  function validate(raw) {
    const parsed = parseRawJson(raw);
    const errors = [];
    const warnings = [];

    const knownTopLevel = new Set(["schemaVersion", "meta", "profileIdentity", "businessEntity", "company"]);
    // "anc" is a content-provenance tag (accepted_used/rejected_not_used)
    // the Rovo agent's own configuration appends on every response — real,
    // expected, and already known to be harmless (unknown top-level keys
    // are never a blocking error), so it's dropped silently instead of
    // warning on every single run.
    const silentlyIgnoredTopLevel = new Set(["anc"]);
    for (const key of Object.keys(parsed)) {
      if (silentlyIgnoredTopLevel.has(key)) continue;
      if (!knownTopLevel.has(key)) warnings.push(`${key} is not a recognized top-level field and was ignored.`);
    }

    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      pushError(errors, "schemaVersion", `must equal "${SCHEMA_VERSION}".`);
    }

    const profileIdentity = validateProfileIdentity(parsed.profileIdentity, errors);
    const businessEntity = validateBusinessEntity(parsed.businessEntity, errors, warnings);
    const company = validateCompany(parsed.company, errors, warnings);

    if (errors.length) throw new SchemaValidationError(errors);

    return {
      schemaVersion: SCHEMA_VERSION,
      meta: isPlainObject(parsed.meta) ? parsed.meta : {},
      profileIdentity,
      businessEntity: businessEntity ?? {},
      company: company ?? {},
      warnings
    };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.schema = { SCHEMA_VERSION, ACTIONS, CONFIDENCE_LEVELS, validate, SchemaValidationError };
})();
