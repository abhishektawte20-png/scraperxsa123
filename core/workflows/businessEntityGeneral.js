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
    if (!input) throw new Error("Website Address field was not found. Open the Business Entity tab and its Entity section so the Website Address box is visible, then publish again.");
    if (record.action === "skip") return { status: "skipped", reason: "action=skip" };

    const current = input.value.trim();
    if (record.action !== "replaceAfterConfirmation" && current) {
      return { status: "skipped", reason: `Website Address already has a value ("${current}").` };
    }

    await globalThis.SXRTS.adapters.textField.applyText(input, record.value);
    if (!globalThis.SXRTS.adapters.textField.verifyText(input, record.value)) {
      throw new Error("Website Address did not retain the proposed value.");
    }
    return { status: "willSave", value: record.value, before: current };
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
    return { status: "willSave", value: match.label, before: current };
  }

  // A fixed status drop-down (Financing, Research, Publish). It is set to the wanted option; when it already shows that
  // option nothing is changed. A different value is overwritten (the team's rule), and what it was is reported.
  async function applyStatusSelect(key, label, envelope) {
    const field = entry(key);
    const select = field.form.select.candidates.map((selector) => document.querySelector(selector)).find(Boolean);
    if (!select) throw new Error(`${label} dropdown was not found. Open the Business Entity tab so it is on screen, then publish again.`);
    if (envelope.action === "skip") return { status: "skipped", reason: "action=skip" };
    const option = globalThis.SXRTS.adapters.nativeSelect.findExactOption(select, envelope.value);
    if (!option) throw new Error(`${label}: "${envelope.value}" is not one of the dropdown's choices in RTS.`);
    const current = select.selectedOptions[0]?.textContent.replace(/\s+/g, " ").trim() || "";
    if (select.selectedOptions[0] === option) return { status: "skipped", reason: `${label} already equals "${current}".` };
    await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(select, option.textContent);
    if (select.selectedOptions[0] !== option) throw new Error(`${label} did not keep "${envelope.value}".`);
    return { status: "willSave", value: envelope.value, before: current };
  }

  // Research Notes (the act log). New text is only ever ADDED AFTER what is there: the box's own links, line breaks and
  // text are left exactly as they are (nodes are appended, nothing is rewritten). Only "replaceAfterConfirmation" rewrites.
  async function applyResearchNotesValue(notes) {
    const field = entry("businessEntity.researchNotes");
    const editable = document.querySelector(field.form.editable.candidates[0]);
    if (!editable) throw new Error("Research Notes field was not found.");
    const ce = globalThis.SXRTS.adapters.contentEditable;

    const before = ce.readContentEditable(editable);
    let seen = before;
    const toAppend = [];
    let replaceWith = null;
    let alreadyMarked = false;

    for (const note of notes) {
      if (note.action === "skip") continue;
      if (note.action === "replaceAfterConfirmation") { replaceWith = note.text; toAppend.length = 0; continue; }
      if (note.action === "updateIfBlank" && seen.trim()) continue;
      // The monitoring mark is only ever added once: any form of it already in the notes means it is there.
      if (/AIGEN_SRX_V1_Y/i.test(note.text) && /AIGEN_SRX_V1_Y/i.test(seen)) { alreadyMarked = true; continue; }
      if (normalize(seen).includes(normalize(note.text))) continue;
      toAppend.push(note.text);
      seen = seen.trim() ? `${seen}\n\n${note.text}` : note.text;
    }

    if (replaceWith === null && !toAppend.length) return { status: "skipped", reason: alreadyMarked ? "Research Notes already has the act log mark (AIGEN_SRX_V1_Y); nothing new to add." : "Research Notes already has this text; nothing new to add." };

    if (replaceWith !== null) {
      await ce.applyContentEditable(editable, replaceWith);
      if (!ce.verifyContentEditable(editable, replaceWith)) throw new Error("Research Notes did not retain the proposed text.");
      return { status: "willSave", added: [replaceWith] };
    }

    for (const text of toAppend) await ce.appendContentEditable(editable, text);
    const after = normalize(ce.readContentEditable(editable));
    if (normalize(before) && !after.includes(normalize(before))) throw new Error("Research Notes lost some of its existing text, so nothing was saved. Reload the profile and try again.");
    for (const text of toAppend) if (!after.includes(normalize(text))) throw new Error("Research Notes did not retain the proposed text.");
    return { status: "willSave", added: toAppend };
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

    for (const [key, name, label] of [["financingStatus", "Financing status", "Financing Status"], ["researchStatus", "Research status", "Research Status"], ["publishStatus", "Publish status", "Publish Status"]]) {
      if (!fields[key]) continue;
      const outcome = await applyStatusSelect(`businessEntity.${key}`, label, fields[key]);
      if (outcome.status === "willSave") outcome.detail = `${name} changed from "${outcome.before || "(blank)"}" to "${outcome.value}".`;
      results[key] = outcome;
      if (outcome.status === "willSave") touched.push(key);
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
    applyStatusSelect,
    saveGeneralGroup
  };
})();
