"use strict";

/*
 * Executes a taught field definition against the live RTS page. Every step
 * either confirms itself against the DOM or throws; nothing is reported as
 * saved on the strength of a dispatched event alone.
 *
 * Save verification is the same INFERRED heuristic the Business Entity
 * General workflow uses: after the Save click the button must return to
 * disabled (or leave the page) AND the written value must still be on the
 * page. A taught field whose Save button never disables is reported as
 * failed rather than assumed saved.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return true;
      await wait(50);
    }
    return false;
  }

  function normalize(value) {
    return globalThis.SXRTS.identityLock.normalizeText(value) || "";
  }

  function readField(field, control) {
    // A placeholder option ("--", "Select...") has an empty value and means "not set".
    if (field.kind === "select") return control.value === "" ? "" : globalThis.SXRTS.adapters.nativeSelect.readSelectedOption(control);
    return globalThis.SXRTS.adapters.textField.readText(control).trim();
  }

  async function writeField(def, field, control, value) {
    if (field.kind === "select") {
      const option = globalThis.SXRTS.customFields.findOption(field, value);
      if (!option) throw new Error(`"${value}" is not a supported value for ${def.label} › ${field.key}.`);
      await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(control, option.label);
      if (!globalThis.SXRTS.adapters.nativeSelect.verifySelection(control, option.label)) {
        throw new Error(`${def.label} › ${field.key} did not retain "${option.label}".`);
      }
      return;
    }
    await globalThis.SXRTS.adapters.textField.applyText(control, value);
    if (!globalThis.SXRTS.adapters.textField.verifyText(control, value)) {
      throw new Error(`${def.label} › ${field.key} did not retain the proposed value.`);
    }
  }

  function findControl(def, field) {
    const control = globalThis.SXRTS.selectorBuilder.resolveFirst(field.selectors);
    if (!control) throw new Error(`${def.label} › ${field.key} was not found on this page. Open the right tab/section, or re-teach the field.`);
    return control;
  }

  async function clickSave(def) {
    const button = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.saveButton);
    if (!button) throw new Error(`The Save button for ${def.label} was not found on this page.`);
    if (button.disabled) throw new Error(`The Save button for ${def.label} is disabled; the change was not registered by the page.`);
    button.click();
    const settled = await waitFor(() => button.disabled || !button.isConnected, 5000);
    if (!settled) throw new Error(`Save did not complete for ${def.label}: the Save button never returned to disabled.`);
  }

  function filled(def, record) {
    return def.fields.filter((field) => record[field.key] !== null && record[field.key] !== undefined && record[field.key] !== "");
  }

  async function applySingle(def, record) {
    const field = def.fields[0];
    const value = record.value;
    if (value === null || value === undefined || value === "") return { status: "skipped", reason: "no value proposed" };

    const control = findControl(def, field);
    const current = readField(field, control);
    if (record.action !== "replaceAfterConfirmation" && current) {
      return { status: "skipped", reason: `${def.label} already has a value ("${current}").` };
    }
    if (normalize(current) === normalize(value)) {
      return { status: "skipped", reason: "duplicate", detail: `${def.label} already equals "${value}".` };
    }

    await writeField(def, field, control, value);
    await clickSave(def);

    const after = findControl(def, field);
    if (normalize(readField(field, after)) !== normalize(value)) {
      throw new Error(`Save did not complete for ${def.label}: the saved value no longer matches.`);
    }
    return { status: "savedValueVerified", name: def.key };
  }

  function rowsOf(def) {
    const columns = def.fields.map((field) => globalThis.SXRTS.selectorBuilder.resolveAll(field.selectors));
    const count = Math.min(...columns.map((c) => c.length));
    return Array.from({ length: Number.isFinite(count) ? count : 0 }, (_, i) =>
      Object.fromEntries(def.fields.map((field, f) => [field.key, readField(field, columns[f][i])])));
  }

  function sameRecord(def, a, b, fields) {
    return fields.every((field) => normalize(a[field.key]) === normalize(b[field.key]));
  }

  async function applyRecord(def, record) {
    const fields = filled(def, record);
    if (!fields.length) return { status: "skipped", reason: "no values proposed" };

    const existing = rowsOf(def);
    if (existing.some((row) => sameRecord(def, row, record, fields))) {
      return { status: "skipped", reason: "duplicate", detail: `${def.label}: an identical entry already exists.` };
    }

    const addButton = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.addButton);
    if (!addButton) throw new Error(`The Add button for ${def.label} was not found on this page.`);
    const before = globalThis.SXRTS.selectorBuilder.resolveAll(def.fields[0].selectors).length;
    addButton.click();

    const appeared = await waitFor(
      () => def.fields.every((field) => globalThis.SXRTS.selectorBuilder.resolveAll(field.selectors).length > before),
      2000
    );
    if (!appeared) throw new Error(`A new ${def.label} row did not appear after clicking Add.`);

    for (const field of fields) {
      const control = globalThis.SXRTS.selectorBuilder.resolveAll(field.selectors)[before];
      await writeField(def, field, control, record[field.key]);
    }

    await clickSave(def);

    const saved = rowsOf(def).some((row) => sameRecord(def, row, record, fields));
    if (!saved) throw new Error(`Save did not complete for ${def.label}: the new entry was not found after saving.`);
    return { status: "savedValueVerified", name: def.key };
  }

  async function applyCustomField(def, record) {
    if (record.action === "skip") return { status: "skipped", reason: "action=skip" };
    return def.kind === "single" ? applySingle(def, record) : applyRecord(def, record);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.customField = { applyCustomField, rowsOf };
})();
