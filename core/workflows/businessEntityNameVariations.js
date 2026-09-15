"use strict";

/*
 * Business Entity > Entity > Name Variations workflow, built entirely on
 * the evidenced selectors in registry/businessEntity.nameVariations.js.
 * Every step either confirms itself against the live DOM or throws — it
 * never reports success on the strength of a dispatched event alone.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getEntry() {
    const entry = globalThis.SXRTS.registry.getField("businessEntity.nameVariations");
    if (!entry || entry.evidenceStatus !== "ready") {
      throw new Error("businessEntity.nameVariations is not evidenced/ready.");
    }
    return entry;
  }

  function queryFirst(candidates) {
    for (const selector of candidates) {
      const found = document.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  async function ensureExpanded(entry) {
    if (queryFirst(entry.addButton.candidates)) return;
    const toggle = Array.from(document.querySelectorAll("a, button, span, div"))
      .find((node) => node.textContent.trim() === entry.navigation.expandToggleText);
    if (!toggle) {
      throw new Error(`Could not find the "${entry.navigation.expandToggleText}" control, and the Add button is not already visible.`);
    }
    toggle.click();
    await wait(150);
    if (!queryFirst(entry.addButton.candidates)) {
      throw new Error("Name variations did not expand after clicking the toggle.");
    }
  }

  function readExistingRecords(entry) {
    const nameInputs = Array.from(document.querySelectorAll(entry.form.nameInput.candidates[0]));
    const typeSelects = Array.from(document.querySelectorAll(entry.form.typeDropdown.candidates[0]));
    if (nameInputs.length !== typeSelects.length) {
      // Deliberately fails loudly with the raw counts rather than guessing
      // which element is the extra/missing one — this exact mismatch (seen
      // consistently as 0 vs 1 on profiles with no existing name
      // variations yet) is still an open investigation; see
      // docs/evidence-checklist.md.
      throw new Error(
        `Couldn't verify existing name variations on this page: found ${nameInputs.length} name field(s) but ${typeSelects.length} type dropdown(s) (they should match). ` +
        "This has been seen when a profile has no existing name variations yet. No changes were made. " +
        `[diagnostic: ${nameInputs.length} name input(s) vs ${typeSelects.length} type dropdown(s)]`
      );
    }
    return nameInputs.map((input, index) => ({
      name: input.value,
      type: typeSelects[index].selectedOptions[0]?.textContent.trim() || "",
      nameInput: input,
      typeSelect: typeSelects[index]
    }));
  }

  function resolveTypeOption(entry, requestedType) {
    const normalize = globalThis.SXRTS.identityLock.normalizeText;
    const match = entry.form.typeDropdown.options.find(
      (option) => normalize(option.label) === normalize(requestedType) || normalize(option.code) === normalize(requestedType)
    );
    if (!match) {
      const supported = entry.form.typeDropdown.options.map((o) => o.label).join(", ");
      throw new Error(`"${requestedType}" is not a supported Name Type. Supported values: ${supported}.`);
    }
    return match;
  }

  async function waitForNewRow(entry, beforeCount) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const names = document.querySelectorAll(entry.form.nameInput.candidates[0]);
      const types = document.querySelectorAll(entry.form.typeDropdown.candidates[0]);
      if (names.length > beforeCount && names.length === types.length) {
        return { nameInput: names[beforeCount], typeSelect: types[beforeCount] };
      }
      await wait(25);
    }
    return null;
  }

  async function waitForSaved(input, expectedValue, addedClass) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (
        input.classList.contains(addedClass) &&
        input.value === expectedValue &&
        input.dataset.defaultvalue === expectedValue
      ) {
        return true;
      }
      await wait(50);
    }
    return false;
  }

  // candidate: { name, type } — type must match one of the registry's
  // TYPE_OPTIONS labels or codes exactly (normalized).
  async function applyNameVariation(candidate) {
    const entry = getEntry();
    await ensureExpanded(entry);

    const typeOption = resolveTypeOption(entry, candidate.type);
    const existing = readExistingRecords(entry);
    const isDuplicate = globalThis.SXRTS.duplicates.isDuplicateRecord(
      existing.map((record) => ({ name: record.name, type: record.type })),
      { name: candidate.name, type: typeOption.label },
      entry.duplicateRule.matchOn
    );
    if (isDuplicate) {
      return { status: "skipped", reason: "duplicate", detail: `"${candidate.name}" (${typeOption.label}) already exists.` };
    }

    const addButton = queryFirst(entry.addButton.candidates);
    if (!addButton) throw new Error("Add New Name Variation button was not found.");
    const beforeCount = document.querySelectorAll(entry.form.nameInput.candidates[0]).length;
    addButton.click();

    const newRow = await waitForNewRow(entry, beforeCount);
    if (!newRow) throw new Error("A new name variation row did not appear after clicking Add New Name Variation.");

    await globalThis.SXRTS.adapters.textField.applyText(newRow.nameInput, candidate.name);
    if (!globalThis.SXRTS.adapters.textField.verifyText(newRow.nameInput, candidate.name)) {
      throw new Error("The new name variation field did not retain the proposed name.");
    }

    await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(newRow.typeSelect, typeOption.label);

    const saveButton = queryFirst(entry.saveButton.candidates);
    if (!saveButton) throw new Error("The Name Variations Save button was not found.");
    if (saveButton.disabled) throw new Error("The Name Variations Save button is disabled; the new row was not registered as a change.");
    saveButton.click();

    const saved = await waitForSaved(newRow.nameInput, candidate.name, entry.verification.addedClass);
    if (!saved) throw new Error("Save did not complete: the saved-value signal was not observed in time.");

    return { status: "savedValueVerified", name: candidate.name, type: typeOption.label };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.businessEntityNameVariations = { applyNameVariation, readExistingRecords, resolveTypeOption };
})();
