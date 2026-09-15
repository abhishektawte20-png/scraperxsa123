"use strict";

/*
 * Business Entity > Entity > General group: Website Address, Email
 * Default Structure, Research Notes. All three share one Save button
 * (#saveBusinessEntityButton), so they are applied together and saved
 * with a single click, per registry/businessEntity.general.js.
 *
 * Save verification uses an INFERRED heuristic (button returns to
 * disabled + values still match) — see the evidenceStatus note in that
 * registry file (evidenceStatus is "ready"; this workflow IS reachable
 * from the panel's publish flow).
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return globalThis.SXRTS.identityLock.normalizeText(value);
  }

  async function waitFor(getValue, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (getValue()) return true;
      await wait(50);
    }
    return false;
  }

  function entry(key) {
    const found = globalThis.SXRTS.registry.getField(key);
    if (!found) throw new Error(`No registry entry for ${key}.`);
    return found;
  }

  async function applyWebsiteAddressValue(record) {
    const field = entry("businessEntity.websiteAddresses");
    const input = document.querySelector(field.form.input.candidates[0]);
    if (!input) throw new Error("Website Address field was not found.");
    if (record.action === "skip") return { status: "skipped", reason: "action=skip" };

    const current = input.value.trim();
    if (record.action !== "replaceAfterConfirmation" && current) {
      return { status: "skipped", reason: `Website Address already has a value ("${current}").` };
    }

    await globalThis.SXRTS.adapters.textField.applyText(input, record.value);
    if (!globalThis.SXRTS.adapters.textField.verifyText(input, record.value)) {
      throw new Error("Website Address did not retain the proposed value.");
    }
    return { status: "willSave", value: record.value };
  }

  async function applyEmailDefaultStructureValue(envelope) {
    const field = entry("businessEntity.emailDefaultStructure");
    const select = document.querySelector(field.form.select.candidates[0]);
    if (!select) throw new Error("Email Default Structure dropdown was not found.");
    if (envelope.action === "skip") return { status: "skipped", reason: "action=skip" };

    const current = select.selectedOptions[0]?.textContent.trim() || "";
    if (envelope.action !== "replaceAfterConfirmation" && current) {
      return { status: "skipped", reason: `Email Default Structure is already set ("${current}").` };
    }

    const match = field.form.select.options.find(
      (option) => normalize(option.label) === normalize(envelope.value) || option.code === String(envelope.value)
    );
    if (!match) {
      throw new Error(`"${envelope.value}" is not a supported Email Default Structure value.`);
    }

    await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(select, match.label);
    return { status: "willSave", value: match.label };
  }

  async function applyResearchNotesValue(notes) {
    const field = entry("businessEntity.researchNotes");
    const editable = document.querySelector(field.form.editable.candidates[0]);
    if (!editable) throw new Error("Research Notes field was not found.");

    let finalText = globalThis.SXRTS.adapters.contentEditable.readContentEditable(editable);
    const added = [];
    let changed = false;

    for (const note of notes) {
      if (note.action === "skip") continue;
      if (note.action === "replaceAfterConfirmation") {
        finalText = note.text;
        added.length = 0;
        added.push(note.text);
        changed = true;
        continue;
      }
      if (note.action === "updateIfBlank" && finalText.trim()) continue;
      if (normalize(finalText).includes(normalize(note.text))) continue;
      finalText = finalText.trim() ? `${finalText}\n${note.text}` : note.text;
      added.push(note.text);
      changed = true;
    }

    if (!changed) return { status: "skipped", reason: "No new research notes to add." };

    await globalThis.SXRTS.adapters.contentEditable.applyContentEditable(editable, finalText);
    if (!globalThis.SXRTS.adapters.contentEditable.verifyContentEditable(editable, finalText)) {
      throw new Error("Research Notes did not retain the proposed text.");
    }
    return { status: "willSave", added };
  }

  async function saveGeneralGroup() {
    const field = entry("businessEntity.websiteAddresses"); // any of the 3 entries share the same Save button
    const saveButton = document.querySelector(field.saveButton.candidates[0]);
    if (!saveButton) return { success: false, reason: "The General group Save button was not found." };
    if (saveButton.disabled) return { success: false, reason: "Save button is disabled; no changes were registered." };

    saveButton.click();
    const becameDisabled = await waitFor(() => saveButton.disabled === true, 5000);
    if (!becameDisabled) {
      return { success: false, reason: "Save did not complete: the Save button never returned to a disabled (saved) state." };
    }
    return { success: true };
  }

  // fields: { websiteAddresses?: [...], emailDefaultStructure?: {...}, researchNotes?: [...] }
  async function applyBusinessEntityGeneral(fields) {
    const results = {};
    const touched = [];

    if (fields.websiteAddresses?.length) {
      const outcome = await applyWebsiteAddressValue(fields.websiteAddresses[0]);
      results.websiteAddresses = outcome;
      if (outcome.status === "willSave") touched.push("websiteAddresses");
    }

    if (fields.emailDefaultStructure) {
      const outcome = await applyEmailDefaultStructureValue(fields.emailDefaultStructure);
      results.emailDefaultStructure = outcome;
      if (outcome.status === "willSave") touched.push("emailDefaultStructure");
    }

    if (fields.researchNotes?.length) {
      const outcome = await applyResearchNotesValue(fields.researchNotes);
      results.researchNotes = outcome;
      if (outcome.status === "willSave") touched.push("researchNotes");
    }

    if (!touched.length) {
      return { status: "skipped", reason: "Nothing to save.", results };
    }

    const saveOutcome = await saveGeneralGroup();
    for (const key of touched) {
      results[key].status = saveOutcome.success ? "savedValueVerified" : "failed";
      if (!saveOutcome.success) results[key].reason = saveOutcome.reason;
    }
    return { status: saveOutcome.success ? "savedValueVerified" : "failed", results };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.businessEntityGeneral = {
    applyBusinessEntityGeneral,
    applyWebsiteAddressValue,
    applyEmailDefaultStructureValue,
    applyResearchNotesValue,
    saveGeneralGroup
  };
})();
