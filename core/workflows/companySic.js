"use strict";

/*
 * Company > SIC workflow, built on registry/company.sic.js. Same
 * repeatable-record shape as businessEntityNameVariations (count-based
 * new-row detection, since new rows have no distinguishing attribute
 * evidenced yet), but with an optional Source dropdown instead of a
 * required Type dropdown.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return globalThis.SXRTS.identityLock.normalizeText(value);
  }

  function getEntry() {
    const entry = globalThis.SXRTS.registry.getField("company.sicCodes");
    if (!entry) throw new Error("No registry entry for company.sicCodes.");
    return entry;
  }

  function queryFirst(candidates) {
    for (const selector of candidates) {
      const found = document.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function readExistingRecords(entry) {
    const codeInputs = Array.from(document.querySelectorAll(entry.form.codeInput.candidates[0]));
    const sourceSelects = Array.from(document.querySelectorAll(entry.form.sourceDropdown.candidates[0]));
    if (codeInputs.length !== sourceSelects.length) {
      throw new Error(`SIC rows are out of sync: ${codeInputs.length} code input(s) vs ${sourceSelects.length} source dropdown(s).`);
    }
    return codeInputs.map((input, index) => ({
      code: input.value,
      classificationSource: sourceSelects[index].selectedOptions[0]?.textContent.trim() || null,
      codeInput: input,
      sourceSelect: sourceSelects[index]
    }));
  }

  function resolveSourceOption(entry, requestedSource) {
    if (!requestedSource) return null;
    const match = entry.form.sourceDropdown.options.find(
      (option) => normalize(option.label) === normalize(requestedSource) || option.code === String(requestedSource)
    );
    if (!match) {
      const supported = entry.form.sourceDropdown.options.map((o) => o.label).join(", ");
      throw new Error(`"${requestedSource}" is not a supported SIC Source. Supported values: ${supported}.`);
    }
    return match;
  }

  async function waitForNewRow(entry, beforeCount) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const codes = document.querySelectorAll(entry.form.codeInput.candidates[0]);
      const sources = document.querySelectorAll(entry.form.sourceDropdown.candidates[0]);
      if (codes.length > beforeCount && codes.length === sources.length) {
        return { codeInput: codes[beforeCount], sourceSelect: sources[beforeCount] };
      }
      await wait(25);
    }
    return null;
  }

  async function saveAndVerify(saveButton, codeInput, expectedCode) {
    if (saveButton.disabled) throw new Error("The SIC Save button is disabled; the new row was not registered as a change.");
    saveButton.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (saveButton.disabled === true && codeInput.value === expectedCode) return true;
      await wait(50);
    }
    return false;
  }

  // candidate: { code, classificationSource, action }
  async function applySicCode(candidate) {
    const entry = getEntry();
    if (candidate.action === "skip") return { status: "skipped", reason: "action=skip" };

    const existing = readExistingRecords(entry);
    const isDuplicate = globalThis.SXRTS.duplicates.isDuplicateRecord(
      existing.map((record) => ({ code: record.code })),
      { code: candidate.code },
      entry.duplicateRule.matchOn
    );
    if (isDuplicate) {
      return { status: "skipped", reason: "duplicate", detail: `SIC code "${candidate.code}" already exists.` };
    }

    const sourceOption = resolveSourceOption(entry, candidate.classificationSource);

    const addButton = queryFirst(entry.addButton.candidates);
    if (!addButton) throw new Error("Add New Sic Industry Path button was not found.");
    const beforeCount = document.querySelectorAll(entry.form.codeInput.candidates[0]).length;
    addButton.click();

    const newRow = await waitForNewRow(entry, beforeCount);
    if (!newRow) throw new Error("A new SIC row did not appear after clicking Add New Sic Industry Path.");

    await globalThis.SXRTS.adapters.textField.applyText(newRow.codeInput, candidate.code);
    if (!globalThis.SXRTS.adapters.textField.verifyText(newRow.codeInput, candidate.code)) {
      throw new Error("The new SIC code field did not retain the proposed value.");
    }

    if (sourceOption) {
      await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(newRow.sourceSelect, sourceOption.label);
    }

    const saveButton = queryFirst(entry.saveButton.candidates);
    if (!saveButton) throw new Error("The SIC Save button was not found.");

    const saved = await saveAndVerify(saveButton, newRow.codeInput, candidate.code);
    if (!saved) throw new Error("Save did not complete: the SIC Save button never returned to a disabled (saved) state.");

    return { status: "savedValueVerified", code: candidate.code, classificationSource: sourceOption?.label ?? null };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.companySic = { applySicCode, readExistingRecords, resolveSourceOption };
})();
