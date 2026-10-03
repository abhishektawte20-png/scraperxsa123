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

  // How long to wait for the popup to appear / disappear. Exposed so tests
  // do not have to sit through the real waits.
  const TIMEOUTS = { open: 5000, close: 1500 };

  // jsdom and real pages both: hidden by the attribute, display:none or
  // visibility:hidden on the element or any ancestor.
  function isShown(node) {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden) return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
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

  // A field inside a popup is the first match that is actually on screen; a
  // closed popup can leave a hidden copy of the same inputs in the page.
  function shownControls(def, field) {
    const all = globalThis.SXRTS.selectorBuilder.resolveAll(field.selectors);
    return def.openButton ? all.filter(isShown) : all;
  }

  function findControl(def, field) {
    const control = shownControls(def, field)[0];
    if (!control) throw new Error(`${def.label} › ${field.key} was not found on this page. Open the right tab/section, or re-teach the field.`);
    return control;
  }

  const BUTTONS = "button, [role=button], input[type=button], input[type=submit], a";

  // Like resolveButtonByDefinition, but for a popup only a button that is
  // on screen counts (the page may keep a hidden "Save" per dialog).
  function findButton(def, button) {
    if (!def.openButton) return globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(button);
    const bySelector = globalThis.SXRTS.selectorBuilder.resolveAll(button?.selectors).find(isShown);
    if (bySelector) return bySelector;
    if (!button?.text) return null;
    return Array.from(document.querySelectorAll(BUTTONS))
      .find((node) => isShown(node) && (node.textContent || node.value || "").trim().replace(/\s+/g, " ") === button.text) || null;
  }

  // Opens the popup (when the field is inside one and it is not already
  // open). Returns true when this call opened it, so the caller knows to
  // close it again.
  async function ensureOpen(def) {
    if (!def.openButton) return false;
    const field = def.fields[0];
    if (shownControls(def, field).length) return false;
    const opener = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
    if (!opener) throw new Error(`The button that opens the popup for ${def.label} was not found on this page. Open the right tab/section, or re-map the field.`);
    if (opener.disabled) throw new Error(`The button that opens the popup for ${def.label} is disabled right now.`);
    opener.click();
    const opened = await waitFor(() => shownControls(def, field).length > 0, TIMEOUTS.open);
    if (!opened) throw new Error(`The popup for ${def.label} did not open after clicking "${def.openButton.text || "the button"}".`);
    return true;
  }

  // Best effort: the Close button if one was mapped, otherwise Escape. Never
  // throws; a popup that stays open does not undo a verified save.
  async function closePopup(def) {
    if (!def.openButton) return;
    const field = def.fields[0];
    if (!shownControls(def, field).length) return;
    const close = def.closeButton ? findButton(def, def.closeButton) : null;
    if (close && !close.disabled) {
      close.click();
    } else {
      for (const target of [document.activeElement, document]) {
        target?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      }
    }
    await waitFor(() => !shownControls(def, field).length, TIMEOUTS.close);
  }

  async function clickSave(def) {
    const button = findButton(def, def.saveButton);
    if (!button) throw new Error(`The Save button for ${def.label} was not found on this page.`);
    if (button.disabled) throw new Error(`The Save button for ${def.label} is disabled; the change was not registered by the page.`);
    button.click();
    const settled = await waitFor(() => button.disabled || !button.isConnected || (def.openButton && !isShown(button)), 5000);
    if (!settled) throw new Error(`Save did not complete for ${def.label}: the Save button never returned to disabled.`);
  }

  function filled(def, record) {
    return def.fields.filter((field) => record[field.key] !== null && record[field.key] !== undefined && record[field.key] !== "");
  }

  async function applySingle(def, record) {
    const field = def.fields[0];
    const value = record.value;
    if (value === null || value === undefined || value === "") return { status: "skipped", reason: "no value proposed" };

    let weOpened = false;
    try {
      weOpened = await ensureOpen(def);
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

      // A popup usually closes on Save, taking the input with it. Read the
      // value back from the popup again so success is never assumed.
      if (def.openButton && !shownControls(def, field).length) weOpened = (await reopenForReadBack(def)) || weOpened;
      const after = findControl(def, field);
      if (normalize(readField(field, after)) !== normalize(value)) {
        throw new Error(`Save did not complete for ${def.label}: the saved value no longer matches.`);
      }
      return { status: "savedValueVerified", name: def.key };
    } finally {
      if (weOpened) await closePopup(def);
    }
  }

  async function reopenForReadBack(def) {
    try {
      return await ensureOpen(def);
    } catch (error) {
      throw new Error(`${def.label} was saved, but the popup could not be reopened to confirm it (${error.message}). Please check it in RTS.`);
    }
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
  globalThis.SXRTS.workflows.customField = { applyCustomField, rowsOf, TIMEOUTS };
})();
