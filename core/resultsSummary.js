"use strict";

/*
 * Generates human-readable summaries of workflow execution results,
 * with explanations and suggested solutions for failures.
 */
(() => {
  const SOLUTION_MAP = {
    "duplicate": "This value already exists in the profile. Verify it matches what you want, or use replaceAfterConfirmation to overwrite.",
    "action=skip": "This field was marked as 'skip' in the Rovo response. No action taken.",
    "out of sync": "The form structure doesn't match expectations. Reload the page and try again. If it persists, contact support.",
    "not found": "The field or button could not be located on the page. Verify the profile section is expanded and visible.",
    "did not retain": "The value was typed but didn't stay. This may be a form interaction issue. Try again, or check if a form validation is blocking it.",
    "did not appear": "Clicking Add did not create a new row. The form may have changed. Reload and try again.",
    "Save button": "The Save button is disabled or missing. The form may not have registered your change. Reload the page and try again.",
    "did not complete": "Save did not succeed. Check the page for error messages, then try again.",
    "not evidenced": "The field is not yet supported by this extension. Check the field status in the panel.",
    "rows out of sync": "Name variation rows don't match dropdown count. This may mean the formal name entry is orphaned. Reload and try again.",
    "No shared strong identifier": "The profile identity could not be verified. Manually confirm you're on the correct profile and try again."
  };

  // "Nothing to do": RTS already holds the value. Not a failure, not a problem.
  const ALREADY = /already (has|exists|equals|ticked|there|linked|have)|already has an entry|\bduplicate\b|is already/i;
  const isAlready = (text) => ALREADY.test(String(text ?? ""));

  const NAMES = {
    "businessEntity.nameVariations": "Name variations", "businessEntity.websiteAddresses": "Website address",
    "businessEntity.emailDefaultStructure": "Email default structure", "businessEntity.researchNotes": "Research notes",
    "company.sicCodes": "SIC codes", "company.naicsCodes": "NAICS codes", "company.keywords": "Keywords",
    "businessEntity.financingStatus": "Financing status", "businessEntity.researchStatus": "Research status", "businessEntity.publishStatus": "Publish status", "businessEntity.ownershipStatus": "Ownership status history", "businessEntity.businessStatus": "Business status history",
    "extras.verticals": "Verticals", "company.verticals": "Verticals",
    "company.briefDescription": "Brief description", "company.fullDescription": "Full description",
    "businessEntity.socialMediaIdentifiers": "Social media", "company.sites": "Site"
  };
  function friendly(field) {
    const base = String(field).replace(/\[\d+\]/g, "");
    return NAMES[base] || globalThis.SXRTS?.outputFields?.get?.(base)?.label || field;
  }
  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const shorten = (text, n = 110) => (String(text).length > n ? `${String(text).slice(0, n - 1)}\u2026` : String(text));

  function getSolution(error) {
    for (const [key, solution] of Object.entries(SOLUTION_MAP)) {
      if (error.includes(key)) {
        return solution;
      }
    }
    return "Try refreshing the page and attempting again. If the issue persists, check the RTS form for validation errors.";
  }

  function formatResult(field, result) {
    if (result.status === "savedValueVerified") {
      return {
        icon: "✓",
        status: "success",
        label: field,
        message: result.detail || `Added ${result.name || result.code || result.value || "value"} successfully`,
        detail: null
      };
    }

    if (result.status === "savedStateVerified") {
      return {
        icon: "✓",
        status: "success",
        label: field,
        message: result.note || `Saved ${result.name || "value"}; RTS now shows it as linked`,
        detail: result.detail || null
      };
    }

    if (result.status === "skipped" && (isAlready(result.reason) || isAlready(result.detail))) {
      return {
        icon: "\u2713",
        status: "already",
        label: field,
        message: "Already in RTS",
        detail: shorten(result.detail || result.reason || "")
      };
    }

    if (result.status === "skipped") {
      const reasons = {
        "duplicate": "already exists",
        "action=skip": "marked skip",
        "action=updateIfBlank and has value": "already has value",
        "action=addIfMissing and has value": "already exists"
      };
      const reason = reasons[result.reason] || result.reason;
      return {
        icon: "⊘",
        status: "skipped",
        label: field,
        message: `Skipped (${reason})`,
        detail: result.detail || null
      };
    }

    if (result.status === "error") {
      return {
        icon: "✗",
        status: "error",
        label: field,
        message: result.error || "Unknown error",
        detail: getSolution(result.error || "")
      };
    }

    return {
      icon: "?",
      status: "unknown",
      label: field,
      message: JSON.stringify(result),
      detail: null
    };
  }

  function buildSummary(results) {
    const byField = new Map();

    for (const [field, fieldResults] of Object.entries(results)) {
      const formatted = Array.isArray(fieldResults)
        ? fieldResults.map((r) => formatResult(field, r))
        : [formatResult(field, fieldResults)];
      byField.set(field, formatted);
    }

    const counts = {
      success: 0,
      failed: 0,
      skipped: 0,
      already: 0
    };

    for (const fieldResults of byField.values()) {
      for (const result of fieldResults) {
        if (result.status === "success") counts.success++;
        else if (result.status === "error") counts.failed++;
        else if (result.status === "already") counts.already++;
        else if (result.status === "skipped") counts.skipped++;
      }
    }

    return {
      byField,
      counts,
      html: generateHtml(byField, counts)
    };
  }

  // What a researcher needs to know about one item that did not go through, in a few plain words. The exact message stays in the
  // details (and in the report for the developer).
  // "check": the save was pressed and RTS accepted it but the read-back could not confirm it (the value is probably there).
  // "notSaved": the value was not accepted at all.
  const CHECK = /Save did not complete|no longer (there|matches)|not found after saving|not in the .* list|not read back|could not be reopened|was pressed, but|does not show/i;
  function plainReason(message) {
    const text = String(message ?? "");
    if (CHECK.test(text) && !/did not retain/i.test(text)) return { kind: "check", words: "saved, but please check it in RTS" };
    if (/No popup window opened|BLOCKED|blocked/i.test(text)) return { kind: "notSaved", words: "the window did not open (allow pop-ups for RTS, then press Try again)" };
    if (/not found|not on screen|No row labelled/i.test(text)) return { kind: "notSaved", words: "could not find this box on the page" };
    if (/did not retain|disabled|not registered|refus|did not accept/i.test(text)) return { kind: "notSaved", words: "RTS did not accept it" };
    return { kind: "notSaved", words: "not saved, please add it by hand or try again" };
  }

  // The short version a researcher sees: one headline, and only what needs a look, in plain words. No ticks, no crosses, no codes.
  function simpleHtml(byField, counts) {
    const look = [];
    for (const [field, results] of byField.entries()) for (const r of results) if (r.status === "error") look.push({ name: friendly(field), ...plainReason(r.message) });
    const done = counts.success + counts.already;
    const head = look.length
      ? `<div class="simple-head simple-warn">${done} done \u00B7 ${look.length} to look at</div>`
      : `<div class="simple-head simple-ok">All done \u00B7 ${done} saved</div>`;
    const seen = new Set();
    const lines = look.filter((x) => { const key = `${x.name}|${x.words}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .map((x) => `<div class="simple-look"><b>${esc(x.name)}</b>: ${esc(x.words)}</div>`);
    return `${head}${lines.join("")}${look.length ? `<div class="helptext">Everything else was saved. If you want us to look into it, press \"Send to developer\" below.</div>` : ""}`;
  }

  // One line per field, worst first (kept for the developer, folded away).
  function detailsHtml(byField, counts) {
    const line = (field, r) => `<div class="summary-item summary-item-${r.status}"><span class="summary-icon">${r.icon}</span><span class="summary-field">${esc(friendly(field))}</span><span class="summary-message">${esc(shorten(r.message))}</span></div>${r.detail && r.status === "error" ? `<div class="summary-detail">${esc(r.detail)}</div>` : ""}`;
    const rows = { error: [], success: [], skipped: [], already: [] };
    for (const [field, results] of byField.entries()) for (const r of results) (rows[r.status] || rows.skipped).push(line(field, r));

    const out = [`<div class="summary-header"><div class="summary-stats">Saved ${counts.success} \u00B7 Already in RTS ${counts.already} \u00B7 Needs attention ${counts.failed}${counts.skipped ? ` \u00B7 Skipped ${counts.skipped}` : ""}</div></div>`];
    out.push(...rows.error, ...rows.success, ...rows.skipped);
    if (rows.already.length) out.push(`<details class="summary-fold"><summary>Already in RTS (${rows.already.length}): nothing to do</summary>${rows.already.join("")}</details>`);
    return out.join("\n");
  }

  function generateHtml(byField, counts) {
    return `${simpleHtml(byField, counts)}<details class="summary-fold summary-dev"><summary>Details (for the developer)</summary>${detailsHtml(byField, counts)}</details>`;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.resultsSummary = { buildSummary, formatResult, getSolution, isAlready, friendly, plainReason };
})();
