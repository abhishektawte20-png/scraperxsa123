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
        message: `Added ${result.name || result.code || result.value || "value"} successfully`,
        detail: null
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
      skipped: 0
    };

    for (const fieldResults of byField.values()) {
      for (const result of fieldResults) {
        if (result.status === "success") counts.success++;
        else if (result.status === "error") counts.failed++;
        else if (result.status === "skipped") counts.skipped++;
      }
    }

    return {
      byField,
      counts,
      html: generateHtml(byField, counts)
    };
  }

  function generateHtml(byField, counts) {
    const sections = [];

    sections.push(`<div class="summary-header">`);
    sections.push(`  <div class="summary-stats">Published ${counts.success}, skipped ${counts.skipped}, failed ${counts.failed}.</div>`);
    sections.push(`</div>`);

    for (const [field, results] of byField.entries()) {
      for (const result of results) {
        const icon = result.icon;
        const statusClass = result.status;
        const message = result.message;
        const detail = result.detail;

        sections.push(`<div class="summary-item summary-item-${statusClass}">`);
        sections.push(`  <div class="summary-item-header">`);
        sections.push(`    <span class="summary-icon">${icon}</span>`);
        sections.push(`    <div class="summary-item-text">`);
        sections.push(`      <div class="summary-field">${field}</div>`);
        sections.push(`      <div class="summary-message">${message}</div>`);
        sections.push(`    </div>`);
        sections.push(`  </div>`);
        if (detail) {
          sections.push(`  <div class="summary-detail">💡 ${detail}</div>`);
        }
        sections.push(`</div>`);
      }
    }

    return sections.join("\n");
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.resultsSummary = { buildSummary, formatResult, getSolution };
})();
