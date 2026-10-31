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

  // What RTS kept compared with what was typed: lengths and the first place
  // they differ, so a truncated or rewritten value can be seen at a glance.
  function mismatchDetail(typed, now) {
    const a = String(typed ?? "").replace(/\s+/g, " ").trim();
    const b = String(now ?? "").replace(/\s+/g, " ").trim();
    let index = 0;
    while (index < a.length && index < b.length && a[index].toLowerCase() === b[index].toLowerCase()) index++;
    const clip = (text) => JSON.stringify(text.slice(Math.max(0, index - 15), index + 25));
    return `Typed ${a.length} characters; the page now has ${b.length}. They first differ at character ${index + 1}: typed ${clip(a)}, page ${clip(b)}.`;
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
        throw new Error(`Save did not complete for ${def.label}: the saved value no longer matches. ${mismatchDetail(value, readField(field, after))}`);
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

  // ---- a tag box: type a word, pick or add it, press Enter (Keywords) ----
  // The "Add button" the researcher picked is the box itself (or the list around it), the tags
  // already there are plain elements, and Enter turns the typed word into a tag. Tags show their
  // use count ("agentic ai (1185)"), which is ignored when comparing.
  const tagWord = (text) => normalize(String(text ?? "").replace(/\(\s*\d+\s*\)/g, " ").replace(/[\u2715\u2716\u00D7\u2A2F\u2297]\s*$/, " "));

  // Waits (ms) before pressing Enter, and for the tag to appear after it, per attempt. Exposed so tests stay fast.
  const TAG_ATTEMPTS = [{ before: 450, after: 1800 }, { before: 900, after: 2200 }, { before: 1500, after: 3000 }];

  function isTagBox(def) {
    if (def.fields.length !== 1 || def.fields[0].kind !== "text") return false;
    const add = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.addButton);
    const input = globalThis.SXRTS.selectorBuilder.resolveAll(def.fields[0].selectors)[0];
    return Boolean(add && input && (add === input || add.contains(input)));
  }

  function tagsIn(container, input) {
    const out = [];
    for (const node of container.querySelectorAll("*")) {
      if (node === input || node.contains(input) || node.children.length > 0 || node.tagName === "INPUT") continue;
      const word = tagWord(node.textContent);
      if (word && word.length > 1) out.push(word);
    }
    return out;
  }

  async function applyTagBox(def, record) {
    const field = def.fields[0];
    const value = String(record[field.key] ?? "").trim();
    if (!value) return { status: "skipped", reason: "no values proposed" };
    const add = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.addButton);
    const input = globalThis.SXRTS.selectorBuilder.resolveAll(field.selectors).find(isShown);
    if (!add || !input) throw new Error(`The ${def.label} box was not found on this page. Open the right tab/section, or re-map the field.`);
    const container = add.contains(input) && add !== input ? add : (input.parentElement || input);
    const want = tagWord(value);
    if (tagsIn(container, input).includes(want)) return { status: "skipped", reason: "duplicate", detail: `${def.label}: "${value}" is already there.` };

    input.focus();
    await globalThis.SXRTS.adapters.textField.applyText(input, value);
    // The suggestion list is fetched from RTS, so Enter pressed too early is ignored: wait for it to draw
    // (the exact tag if it exists, otherwise "(new)"), and press Enter again if nothing happened.
    let added = false;
    for (let attempt = 0; attempt < TAG_ATTEMPTS.length && !added; attempt++) {
      await waitFor(() => false, TAG_ATTEMPTS[attempt].before);
      if (document.activeElement !== input) input.focus();
      for (const type of ["keydown", "keypress", "keyup"]) {
        input.dispatchEvent(new window.KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      added = await waitFor(() => tagsIn(container, input).includes(want), TAG_ATTEMPTS[attempt].after);
    }
    if (!added) throw new Error(`${def.label}: "${value}" was typed and Enter was pressed, but no tag appeared. The suggestion list may need a click: send the report so the box can be mapped.`);

    // Some pages save on Enter; others enable Save Changes. Press it only if it is waiting.
    const save = findButton(def, def.saveButton);
    if (save && !save.disabled) await clickSave(def);
    await waitFor(() => false, 250); // a page that re-draws the list after saving would drop an unsaved tag
    if (!tagsIn(container, input).includes(want)) throw new Error(`Save did not complete for ${def.label}: the tag "${value}" is no longer there.`);
    return { status: "savedValueVerified", name: def.key };
  }

  async function applyRecord(def, record) {
    const fields = filled(def, record);
    if (!fields.length) return { status: "skipped", reason: "no values proposed" };
    if (isTagBox(def)) return applyTagBox(def, record);

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
    if (!appeared) {
      throw new Error(`A new ${def.label} row did not appear after clicking Add. If this field is a tag box (you type a word and press Enter), it is not supported yet: send the HTML of the box with one tag in it.`);
    }

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
    if (!rows.length) throw new Error(`No row labelled "${label}" was found in the ${def.label} section. Open that section on the page so its rows are visible, then publish again.`);
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

    const tree = def.window.tree;
    const job = tree ? {
      tree: { expander: tree.expander || null, leaf: tree.leaf },
      value: String(record.value),
      preSave: def.window.preSave || [],
      saveButton: def.saveButton
    } : {
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
    if (!result) throw new Error(`${name}: the window ended without telling what happened. Check it in RTS.`);
    if (result.status === "skipped") return { status: "skipped", reason: result.reason };

    if (tree) {
      if (result.fieldRetained === true) return { status: "savedValueVerified", name: def.key };
      // The window closed itself (or could not be read): open it again and read the tick back.
      if (result.status !== "saved" && result.status !== "windowClosedAfterSave") throw new Error(`${name}: the window ended unexpectedly (${result.status}).`);
      // Reading the tick back reopens the window. If that window closes while it is being read, open it again.
      let check = null;
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !check; attempt++) {
        const again = def.rowBy ? null : globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
        if (!again || again.disabled) break;
        try {
          check = await runInWindow(again, { tree: job.tree, value: job.value, verifyOnly: true });
        } catch (error) {
          lastError = error;
          if (!/closed before it could be read|Frame with ID|was removed/i.test(String(error?.message))) throw error;
        }
      }
      if (!check) {
        if (lastError) throw new Error(`${name}: Save was accepted, but the window kept closing while the tick was being read back, so it could not be confirmed. Please check it in RTS.`);
        return { status: "savedStateVerified", name: def.key, detail: "Save was accepted, but the window could not be reopened to read the tick back. Check it in RTS." };
      }
      if (check.status === "verified" && check.checked) return { status: "savedValueVerified", name: def.key };
      throw new Error(`${name}: Save was clicked, but when the window was opened again the choice is not ticked. Please check it in RTS.`);
    }

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

  // A mapped control that is "not found" is often just on the other tab (the run may have left the page on
  // Company while this field lives on Business Entity). Switch tab (which also expands the sections) and try once more.
  const NOT_ON_SCREEN = /was not found on this page|No row labelled|Add button .* was not found|box was not found|button that opens .* was not found/i;
  async function applyCustomField(def, record) {
    try {
      return await applyHere(def, record);
    } catch (error) {
      const nav = globalThis.SXRTS.navigation;
      if (!nav?.navigateToSection || !NOT_ON_SCREEN.test(String(error?.message))) throw error;
      for (const tab of ["Business Entity", "Company"]) {
        try {
          await nav.navigateToSection(tab);
          return await applyHere(def, record);
        } catch (again) {
          if (!NOT_ON_SCREEN.test(String(again?.message))) throw again;
        }
      }
      throw error;
    }
  }

  async function applyHere(def, record) {
    if (record.action === "skip") return { status: "skipped", reason: "action=skip" };
    if (def.tree) return globalThis.SXRTS.workflows.treePicker.apply(def, record);
    if (def.window) return applyWindowed(def, record);
    return def.kind === "single" ? applySingle(def, record) : applyRecord(def, record);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.customField = { TAG_ATTEMPTS, applyCustomField, rowsOf, TIMEOUTS };
})();
