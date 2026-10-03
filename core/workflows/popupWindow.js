"use strict";

/*
 * Runs INSIDE a popup window that RTS opened (for example the "Create Social
 * Media Identifier" form). Injected by the background worker, never by the
 * main page. It fills the mapped fields, presses any buttons that must be
 * pressed before Save (such as "Show existing data"), clicks Save, and
 * reports what it saw. It never reports a save it did not observe: the Save
 * button must have been enabled, clicked, and must then settle.
 */
(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Exposed so tests do not have to sit through the real waits.
  const TIMEOUTS = { fields: 12000, button: 8000, settle: 8000, after: 700 };

  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return true;
      await wait(50);
    }
    return false;
  }

  function isShown(node) {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden) return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }

  function queryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function shownMatches(selectors) {
    for (const selector of selectors || []) {
      const shown = queryAll(selector).filter(isShown);
      if (shown.length) return shown;
    }
    return [];
  }

  const BUTTONS = "button, [role=button], input[type=button], input[type=submit], a";
  const labelOf = (node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ");

  function findButton(button) {
    const bySelector = shownMatches(button?.selectors)[0];
    if (bySelector) return bySelector;
    if (!button?.text) return null;
    return queryAll(BUTTONS).find((node) => isShown(node) && labelOf(node) === button.text) || null;
  }

  const normalize = (value) => globalThis.SXRTS.identityLock.normalizeText(value) || "";
  const adapters = () => globalThis.SXRTS.adapters;

  function read(field, control) {
    if (field.kind === "select") return control.value === "" ? "" : adapters().nativeSelect.readSelectedOption(control);
    return adapters().textField.readText(control).trim();
  }

  async function write(field, control, value) {
    if (field.kind === "select") {
      await adapters().nativeSelect.selectNativeOption(control, value);
      if (!adapters().nativeSelect.verifySelection(control, value)) throw new Error(`The popup did not keep "${value}".`);
      return;
    }
    await adapters().textField.applyText(control, value);
    if (!adapters().textField.verifyText(control, value)) throw new Error("The popup did not keep the proposed value.");
  }

  function report(stage) {
    try {
      chrome.runtime.sendMessage({ type: "sx-window-stage", stage });
    } catch {
      // Reporting is best effort; the result below does not depend on it.
    }
  }

  // job: { replace, fields: [{ selectors, kind, value }], preSave: [button], saveButton }
  async function run(job) {
    const present = await waitFor(() => job.fields.every((field) => shownMatches(field.selectors).length), TIMEOUTS.fields);
    if (!present) throw new Error("The popup window opened, but the mapped fields were not found in it. Re-map the field.");

    const controls = job.fields.map((field) => shownMatches(field.selectors)[0]);
    const currents = controls.map((control, i) => read(job.fields[i], control));
    if (!job.replace && currents.some(Boolean)) {
      window.setTimeout(() => window.close(), 150);
      return { status: "skipped", reason: `The popup already has a value ("${currents.find(Boolean)}").` };
    }
    for (const [i, field] of job.fields.entries()) await write(field, controls[i], field.value);

    for (const button of job.preSave || []) {
      await waitFor(() => findButton(button), TIMEOUTS.button);
      const target = findButton(button);
      if (!target) throw new Error(`The popup button "${button.text || "(unnamed)"}" that must be pressed before Save was not found.`);
      if (!(await waitFor(() => !target.disabled, TIMEOUTS.button))) throw new Error(`The popup button "${button.text || "(unnamed)"}" stayed disabled.`);
      target.click();
      await wait(TIMEOUTS.after);
    }

    const save = findButton(job.saveButton);
    if (!save) throw new Error("The Save button was not found in the popup window.");
    if (!(await waitFor(() => !save.disabled, TIMEOUTS.button))) {
      throw new Error("The popup's Save button stayed disabled after the value was entered. RTS may be asking for something else on that form (read the message in the window).");
    }

    report("saveClicked");
    save.click();
    const settled = await waitFor(() => save.disabled || !save.isConnected || !isShown(save), TIMEOUTS.settle);
    if (!settled) throw new Error("Save did not complete in the popup window: the Save button stayed enabled.");

    // The window is still here. Did it keep what was typed?
    const retained = job.fields.every((field, i) => controls[i].isConnected && normalize(read(field, controls[i])) === normalize(field.value));
    window.setTimeout(() => window.close(), 250);
    return { status: "saved", fieldRetained: retained };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.popupWindow = { run, TIMEOUTS };
})();
