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
  const TIMEOUTS = { open: 5000, close: 1500, rowChange: 10000 };

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

  // ---- a field that is filled in a separate popup window ----
  // The window is a different document, so the background worker watches for
  // it, runs core/workflows/popupWindow.js inside it, and hands the result
  // back over a port. This page then checks that RTS really changed state.
  const WINDOW_TIMEOUT = 90000;

  function queryIn(selector, root) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function shownIn(selectors, root = document) {
    for (const selector of selectors || []) {
      const shown = queryIn(selector, root).filter(isShown);
      if (shown.length) return shown;
    }
    return [];
  }

  const labelOf = (node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ");

  function findRow(def, label) {
    const rows = shownIn([def.rowBy.rowSelector]).filter((row) => globalThis.SXRTS.selectorBuilder.textHasWord(row.textContent, label));
    if (!rows.length) throw new Error(`No row labelled "${label}" was found in this section of RTS. Open the right tab/section.`);
    return rows.sort((a, b) => a.textContent.length - b.textContent.length)[0];
  }

  // The row's own button. Its label must still be the mapped one ("New"):
  // the button's classes are shared with the History and Unlink buttons, and
  // once the row is linked "New" is gone, which is what tells us it saved.
  function rowOpener(def, row) {
    const { selectors, text } = def.openButton;
    for (const selector of selectors || []) {
      const hit = queryIn(selector, row).find((node) => isShown(node) && (!text || labelOf(node) === text));
      if (hit) return hit;
    }
    return text ? queryIn(BUTTONS, row).find((node) => isShown(node) && labelOf(node) === text) || null : null;
  }

  const plain = (value) => String(value ?? "").toLowerCase().replace(/https?:\/\//g, "").replace(/www\./g, "").replace(/\s+/g, " ").replace(/\/+(?=\s|$)/g, "").trim();

  // Everything a row shows for itself: text, input values, link targets.
  function rowShows(row, fields, record) {
    const bits = [row.textContent];
    for (const node of [row, ...row.querySelectorAll("*")]) {
      if (node.value) bits.push(node.value);
      for (const attr of ["href", "title"]) if (node.getAttribute?.(attr)) bits.push(node.getAttribute(attr));
    }
    const shown = plain(bits.join(" "));
    return fields.every((field) => shown.includes(plain(record[field.key])));
  }

  // Click the opener once the background worker is watching, then wait for
  // the worker to report what happened inside the window.
  function runInWindow(opener, job) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "sx-window" });
      let settled = false;
      const finish = (action, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { port.disconnect(); } catch { /* already closed */ }
        action(value);
      };
      const timer = setTimeout(() => finish(reject, new Error("The popup window did not finish in time.")), WINDOW_TIMEOUT);
      port.onMessage.addListener((message) => {
        if (message.type === "armed") opener.click();
        else if (message.type === "result") finish(resolve, message.result);
        else if (message.type === "error") finish(reject, new Error(message.error));
      });
      port.onDisconnect.addListener(() => finish(reject, new Error("The extension connection closed before the popup window finished. Reload the extension and try again.")));
      port.postMessage({ type: "start", mode: "run", job, origin: window.location.origin });
    });
  }

  async function applyWindowed(def, record) {
    const fields = filled(def, record);
    if (!fields.length) return { status: "skipped", reason: def.kind === "single" ? "no value proposed" : "no values proposed" };

    let row = null;
    let opener;
    const label = record.__row;
    if (def.rowBy) {
      if (!label) return { status: "skipped", reason: `${def.label}: the report gives no name to choose the row with.` };
      row = findRow(def, label);
      opener = rowOpener(def, row);
      if (!opener) return { status: "skipped", reason: `${label} already has an entry in RTS (its row has no "${def.openButton.text || "opening"}" button).` };
    } else {
      opener = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
      if (!opener) throw new Error(`The button that opens the popup window for ${def.label} was not found on this page. Open the right tab/section, or re-map the field.`);
    }
    if (opener.disabled) throw new Error(`The button that opens the popup window for ${def.label} is disabled right now.`);

    const job = {
      replace: record.action === "replaceAfterConfirmation",
      fields: fields.map((field) => ({
        selectors: field.selectors,
        kind: field.kind,
        value: field.kind === "select" ? globalThis.SXRTS.customFields.findOption(field, record[field.key]).label : String(record[field.key])
      })),
      preSave: def.window.preSave || [],
      saveButton: def.saveButton
    };
    const name = label ? `${def.label} (${label})` : def.label;
    const result = await runInWindow(opener, job);
    if (result.status === "skipped") return { status: "skipped", reason: result.reason };

    if (!def.rowBy) {
      if (result.fieldRetained) return { status: "savedValueVerified", name: def.key };
      throw new Error(`${name} was saved in the popup window, but the window did not show the value afterwards, so it could not be confirmed. Please check it in RTS.`);
    }

    // The row must now look different: its button is gone, or it shows the value.
    const changed = await waitFor(() => {
      try {
        const current = findRow(def, label);
        return rowShows(current, fields, record) || !rowOpener(def, current);
      } catch {
        return false;
      }
    }, TIMEOUTS.rowChange);
    if (!changed) throw new Error(`${name}: Save was clicked in the popup window, but the ${label} row in RTS still looks unchanged. Reload the profile page and check it.`);
    if (result.fieldRetained || rowShows(findRow(def, label), fields, record)) return { status: "savedValueVerified", name: def.key };
    return {
      status: "savedStateVerified",
      name: def.key,
      detail: `Saved. RTS now shows ${label} as linked. The row does not display the identifier itself, so the value could not be read back; check it in the ${label} window if needed.`
    };
  }

  async function applyCustomField(def, record) {
    if (record.action === "skip") return { status: "skipped", reason: "action=skip" };
    if (def.window) return applyWindowed(def, record);
    return def.kind === "single" ? applySingle(def, record) : applyRecord(def, record);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.customField = { applyCustomField, rowsOf, TIMEOUTS };
})();
