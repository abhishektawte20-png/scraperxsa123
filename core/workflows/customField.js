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
  // Sections of the Company tab whose bar is opened when a field's opening button is missing.
  const SECTION_TITLES = ["Industries and Verticals", "Industry Group", "Industry Tagging"];
  const TIMEOUTS = { open: 5000, close: 1500, rowChange: 10000, retryPause: 1200, enable: 8000, appear: 12000, appearStep: 1500 };

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
    const tf = globalThis.SXRTS.adapters.textField;
    await tf.applyText(control, value);
    if (await tf.retains(control, value, 400)) return;
    // The page did not keep it (it rebuilds its value from keystrokes, or validated it away): type it the way a person does.
    await tf.applyTyped(control, value);
    if (await tf.retains(control, value, 600)) return;
    throw new Error(`${def.label} › ${field.key} did not retain the proposed value. ${mismatchDetail(value, tf.readText(control))}`);
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

      // The value as the report gives it; when the page will not keep it (a date box that wants MM/DD/YYYY, for example) the
      // other forms of the SAME value the report carries are tried in turn.
      let written = value;
      let notKept = null;
      for (const candidate of [value, ...(record.__alternatives || [])]) {
        try { await writeField(def, field, control, candidate); written = candidate; notKept = null; break; } catch (error) {
          if (!/did not retain/.test(String(error?.message))) throw error;
          notKept = notKept || error;
        }
      }
      if (notKept) throw notKept;
      await clickSave(def);

      // A popup usually closes on Save, taking the input with it. Read the
      // value back from the popup again so success is never assumed.
      if (def.openButton && !shownControls(def, field).length) weOpened = (await reopenForReadBack(def)) || weOpened;
      const after = findControl(def, field);
      if (normalize(readField(field, after)) !== normalize(written)) {
        throw new Error(`Save did not complete for ${def.label}: the saved value no longer matches. ${mismatchDetail(written, readField(field, after))}`);
      }
      return { status: "savedValueVerified", name: def.key, before: current };
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

  // A tag drawn as a pill / chip / tag element: its whole text counts (a pill may hold its word next to other markup), and the
  // number of them tells that one more appeared even when its text could not be read.
  const PILL = '[class*="pill"], [class*="chip"], [class*="tag"]';
  const pillsIn = (container, input) => Array.from(container.querySelectorAll(PILL)).filter((node) => node !== input && !node.contains(input) && !node.querySelector(PILL) && node.tagName !== "INPUT");
  const pillWords = (container, input) => pillsIn(container, input).map((node) => tagWord(node.textContent)).filter(Boolean);

  // Suggestion rows RTS may draw under the box ("high jewellery" or "high jewellery (new)"): the one that is this word is clicked.
  function suggestionFor(input, container, value) {
    const want = tagWord(value);
    const rows = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] *, li, [class*="suggest"] *, [class*="option"], [class*="dropdown"] *, [class*="autocomplete"] *, [class*="menu"] *'))
      .filter((node) => isShown(node) && node !== input && !container.contains(node) && node.children.length === 0 && !node.closest("#sxrts-assistant-root"));
    const exact = rows.find((node) => tagWord(node.textContent.replace(/\(\s*new\s*\)/i, " ")) === want);
    return exact || null;
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
    if (tagsIn(container, input).includes(want) || pillWords(container, input).includes(want)) return { status: "skipped", reason: "duplicate", detail: `${def.label}: "${value}" is already there.` };

    input.focus();
    await globalThis.SXRTS.adapters.textField.applyText(input, value);
    // The suggestion list is fetched from RTS, so Enter pressed too early is ignored: wait for it to draw
    // (the exact tag if it exists, otherwise "(new)"), and press Enter again if nothing happened.
    let added = false;
    const pillsBefore = pillsIn(container, input).length;
    const isThere = () => tagsIn(container, input).includes(want) || pillWords(container, input).includes(want) || pillsIn(container, input).length > pillsBefore;
    for (let attempt = 0; attempt < TAG_ATTEMPTS.length && !added; attempt++) {
      await waitFor(() => false, TAG_ATTEMPTS[attempt].before);
      if (document.activeElement !== input) input.focus();
      for (const type of ["keydown", "keypress", "keyup"]) {
        input.dispatchEvent(new window.KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      added = await waitFor(isThere, TAG_ATTEMPTS[attempt].after);
      if (!added) {
        const row = suggestionFor(input, container, value);
        if (row) { row.click(); added = await waitFor(isThere, TAG_ATTEMPTS[attempt].after); }
      }
    }
    if (!added) throw new Error(`${def.label}: "${value}" was typed and Enter was pressed, but no tag appeared. The suggestion list may need a click: send the report so the box can be mapped.`);

    // Some pages save on Enter; others enable Save Changes. Press it only if it is waiting.
    const save = findButton(def, def.saveButton);
    if (save && !save.disabled) await clickSave(def);
    await waitFor(() => false, 250); // a page that re-draws the list after saving would drop an unsaved tag
    if (!(tagsIn(container, input).includes(want) || pillWords(container, input).includes(want) || pillsIn(container, input).length > pillsBefore)) throw new Error(`Save did not complete for ${def.label}: the tag "${value}" is no longer there.`);
    return { status: "savedValueVerified", name: def.key };
  }

  // Several words into one tag box with ONE Save (Keywords): each word is typed and turned into a tag, then Save is pressed once
  // and every tag is read back. Returns one result per record, in the same order. A word that cannot be added is reported on its own
  // and does not stop the others; a word that is not there after Save is reported as failed.
  async function applyTagBoxMany(def, records) {
    const field = def.fields[0];
    const sb = globalThis.SXRTS.selectorBuilder;
    const add = sb.resolveButtonByDefinition(def.addButton);
    const input = sb.resolveAll(field.selectors).find(isShown);
    if (!add || !input) throw new Error(`The ${def.label} box was not found on this page. Open the right tab/section, or re-map the field.`);
    const container = add.contains(input) && add !== input ? add : (input.parentElement || input);
    const there = (want) => tagsIn(container, input).includes(want) || pillWords(container, input).includes(want);
    const results = records.map(() => null);
    const typed = [];
    // RTS keeps at most 10 keywords in the box and drops the rest when it saves (seen: 10 tags kept, the other 3 gone). Every word is
    // still tried (nothing is left untested on a guess); a word dropped because the box is full is reported as a limit, not a failure.
    const limit = Number.isFinite(def.maxTags) ? def.maxTags : (/keyword/i.test(`${def.key} ${def.label}`) ? 10 : Infinity);

    for (let i = 0; i < records.length; i++) {
      const value = String(records[i]?.[field.key] ?? "").trim();
      const want = tagWord(value);
      if (!value) { results[i] = { status: "skipped", reason: "no values proposed" }; continue; }
      if (there(want) || typed.some((t) => t.want === want)) { results[i] = { status: "skipped", reason: "duplicate", detail: `${def.label}: "${value}" is already there.` }; continue; }
      const pillsBefore = pillsIn(container, input).length;
      const isThere = () => there(want) || pillsIn(container, input).length > pillsBefore;
      input.focus();
      await globalThis.SXRTS.adapters.textField.applyText(input, value);
      let added = false;
      for (let attempt = 0; attempt < TAG_ATTEMPTS.length && !added; attempt++) {
        // RTS draws a list of suggestions after typing; Enter pressed before it exists is ignored. Wait for it (at most the usual
        // time), and press Enter the moment it is there.
        await waitFor(() => Boolean(suggestionFor(input, container, value)), TAG_ATTEMPTS[attempt].before);
        if (document.activeElement !== input) input.focus();
        for (const type of ["keydown", "keypress", "keyup"]) input.dispatchEvent(new window.KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        added = await waitFor(isThere, TAG_ATTEMPTS[attempt].after);
        if (!added) {
          const row = suggestionFor(input, container, value);
          if (row) { row.click(); added = await waitFor(isThere, TAG_ATTEMPTS[attempt].after); }
        }
      }
      if (added) typed.push({ i, value, want });
      else results[i] = { status: "failed", reason: `${def.label}: "${value}" was typed and Enter was pressed, but no tag appeared. The suggestion list may need a click: send the report so the box can be mapped.` };
    }
    if (input.value) await globalThis.SXRTS.adapters.textField.applyText(input, ""); // a word that never became a tag is not left in the box

    if (typed.length) {
      // Some pages save on Enter; others enable Save Changes. Press it only if it is waiting: ONCE for all the words.
      const save = findButton(def, def.saveButton);
      let saveError = "";
      if (save && !save.disabled) { try { await clickSave(def); } catch (error) { saveError = error.message; } }
      await waitFor(() => false, 250); // a page that re-draws the list after saving would drop an unsaved tag
      for (const t of typed) {
        if (saveError) results[t.i] = { status: "failed", reason: saveError };
        else if (there(t.want)) results[t.i] = { status: "savedValueVerified", name: def.key };
        else if (pillsIn(container, input).length >= limit) results[t.i] = { status: "skipped", reason: "limit", detail: `${def.label}: RTS kept ${limit} and dropped "${t.value}" (its limit); nothing is wrong, it just does not fit.` };
        else results[t.i] = { status: "failed", reason: `Save did not complete for ${def.label}: the tag "${t.value}" is no longer there.` };
      }
    }
    return results;
  }

  // Is this mapping a tag box (words typed and turned into tags) that is on the page right now?
  const isTagBoxNow = (def) => { try { return def.kind === "record" && isTagBox(def); } catch { return false; } };
  // RTS may draw the box a moment after its section opens: look for it for a while, opening closed sections now and then.
  async function waitForTagBox(def, ms = TIMEOUTS.appear) {
    if (isTagBoxNow(def)) return true;
    await globalThis.SXRTS.navigation?.openClosedSections?.(() => isTagBoxNow(def));
    return waitFor(() => isTagBoxNow(def), ms);
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
  const NO_WINDOW_TEXT = "No popup window opened. Chrome blocked it.";

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
    if (!rows.length) throw new Error(`No row labelled "${label}" was found in the ${def.label} section. Open that section on the page so its rows are visible, then publish again. ${globalThis.SXRTS.navigation?.describeMenu?.() || ""}`);
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
  function runInWindowOnce(opener, job, fresh, refind) {
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
      // RTS may have redrawn the button since it was found (the element in hand is then detached and clicking it does nothing),
      // or it may still be greyed out for a moment: press the live, enabled button.
      const pressOpener = async () => {
        let el = opener;
        const deadline = Date.now() + TIMEOUTS.enable;
        while (Date.now() < deadline) {
          if (!el?.isConnected && refind) el = refind() || el;
          if (el?.isConnected && !el.disabled) break;
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        const popupsBefore = (globalThis.SXRTS.dialogLog?.popups?.() ?? []).length;
        el.click();
        // Chrome refused the window at once (the page's window.open returned nothing): no point waiting ten seconds for it.
        await new Promise((resolve) => setTimeout(resolve, 700));
        const now = globalThis.SXRTS.dialogLog?.popups?.() ?? [];
        if (now.length > popupsBefore && now.slice(popupsBefore).every((t) => t.blocked)) finish(reject, new Error(NO_WINDOW_TEXT));
      };
      port.onMessage.addListener((message) => {
        if (message.type === "armed") pressOpener();
        else if (message.type === "result") finish(resolve, message.result);
        else if (message.type === "error") finish(reject, Object.assign(new Error(message.error), { stale: message.stale === true }));
      });
      port.onDisconnect.addListener(() => finish(reject, new Error("The extension connection closed before the popup window finished. Reload the extension and try again.")));
      port.postMessage({ type: "start", mode: "run", job, origin: window.location.origin, ...(fresh ? { fresh: true } : {}) });
    });
  }

  // If the window that was already open (RTS brings it to the front instead of opening a new one) turns out
  // to hold an old page, it is closed and the button is pressed once more to get a clean window.
  async function runInWindow(opener, job, refind) {
    try {
      return await runInWindowOnce(opener, job, false, refind);
    } catch (error) {
      if (error?.stale !== true) throw error;
      return runInWindowOnce(opener, job, true, refind);
    }
  }

  // Closes any pop-up window of this site that this page opened earlier (left over from a failed run). RTS reuses one named
  // window, so a leftover one would be brought to the front instead of a clean one opening, and then be mistaken for the new one.
  function closeStrayWindows() {
    return new Promise((resolve) => {
      let port;
      try { port = chrome.runtime.connect({ name: "sx-window" }); } catch { resolve(); return; }
      const timer = setTimeout(() => { try { port.disconnect(); } catch { /* gone */ } resolve(); }, 4000);
      port.onMessage.addListener((message) => { if (message.type === "cleaned") { clearTimeout(timer); try { port.disconnect(); } catch { /* gone */ } resolve(); } });
      port.onDisconnect.addListener(() => { clearTimeout(timer); resolve(); });
      port.postMessage({ type: "cleanup", origin: window.location.origin });
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
      if (!opener) {
        // The button can sit inside a section that is still closed (Industry and NAICS are under "Industries and
        // Verticals"). Open it, only if the button is missing, then look again. Nothing is collapsed if it does not help.
        await globalThis.SXRTS.navigation?.ensureSectionOpen(() => globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton), SECTION_TITLES);
        opener = globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
      }
      if (!opener) {
        // RTS draws parts of the Company tab a moment after the tab is in front (and after a section is opened), so the
        // button may simply not be there YET. Keep looking for a while, opening any closed section now and then.
        const find = () => globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
        const deadline = Date.now() + TIMEOUTS.appear;
        let rounds = 0;
        while (!opener && Date.now() < deadline) {
          await waitFor(() => Boolean(find()), TIMEOUTS.appearStep);
          opener = find();
          if (!opener && rounds++ % 2 === 0) await globalThis.SXRTS.navigation?.openClosedSections?.(() => Boolean(find()));
          opener = opener || find();
        }
      }
      if (!opener) throw new Error(`The button that opens the popup window for ${def.label} was not found on this page after waiting ${Math.round(TIMEOUTS.appear / 1000)} seconds and opening the closed sections. Open the right tab/section, or re-map the field. Page check: ${(() => { const g = document.querySelector("#containerIndustryGroup"); const sel = def.openButton?.selectors?.[0]; let n = 0; try { n = sel ? document.querySelectorAll(sel).length : 0; } catch { n = -1; } return `Industry block ${g ? (g.checkVisibility?.() === false ? "present but hidden" : "present") : "missing from the page"}, first mapped selector matches ${n} element(s), ${globalThis.SXRTS.navigation?.describeMenu?.() || ""}`; })()}`);
    }
    if (opener.disabled) await waitFor(() => !opener.disabled, TIMEOUTS.enable);
    if (opener.disabled) throw new Error(`The button that opens the popup window for ${def.label} is disabled right now.`);

    const tree = def.window.tree;
    const job = tree ? {
      tree: { expander: tree.expander || null, leaf: tree.leaf },
      value: String(record.value),
      ...(record.__group ? { group: String(record.__group) } : {}),
      ...(record.undo === true ? { untick: true } : {}),
      preSave: (def.window.preSave || []).filter((button) => !((Boolean(button.selectors?.[0]) && button.selectors[0] === def.saveButton?.selectors?.[0]) || (button.text && def.saveButton?.text && button.text.trim().toLowerCase() === def.saveButton.text.trim().toLowerCase()))),
      saveButton: def.saveButton
    } : {
      replace: record.action === "replaceAfterConfirmation",
      fields: fields.map((field) => ({
        selectors: field.selectors,
        kind: field.kind,
        value: field.kind === "select" ? globalThis.SXRTS.customFields.findOption(field, record[field.key]).label : String(record[field.key])
      })),
      preSave: (def.window.preSave || []).filter((button) => !((Boolean(button.selectors?.[0]) && button.selectors[0] === def.saveButton?.selectors?.[0]) || (button.text && def.saveButton?.text && button.text.trim().toLowerCase() === def.saveButton.text.trim().toLowerCase()))),
      saveButton: def.saveButton
    };
    const name = label ? `${def.label} (${label})` : def.label;
    // A tree window can go away under the script (RTS reloads or closes it). Nothing was confirmed then, so the
    // whole job is run again: it is safe to repeat, because a choice that is already ticked is only reported.
    let result;
    let firstFailure = "";
    const refind = def.rowBy ? null : () => globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
    if (tree && !record.undo) await closeStrayWindows();
    for (let attempt = 0; ; attempt++) {
      try {
        result = await runInWindow(opener, job, refind);
        break;
      } catch (error) {
        // A later try can fail for a different reason than the first. Both are shown, so the cause is not hidden.
        if (attempt > 0 && firstFailure && !/first try had failed/.test(String(error?.message))) error.message += ` (The first try had failed with: ${firstFailure})`;
        if (/No popup window opened/.test(String(error?.message))) {
          const said = (globalThis.SXRTS.dialogLog?.peek?.() ?? []).map((entry) => `"${entry.message}"`).join(", ");
          const tried = globalThis.SXRTS.dialogLog?.popups?.() ?? [];
          // What really happened: Chrome refused the window, or the page never asked for one.
          const why = tried.some((t) => t.blocked)
            ? "WHY: the page asked for the window and Chrome BLOCKED it (its pop-up blocker; a window that a script opens needs a recent click). Click the pop-up icon at the right end of the address bar and choose \"Always allow pop-ups from rts.pitchbook.com\", or press \"Try again\" below (a real click is always allowed)."
            : tried.length ? "The page opened a window but it was not found. Close other RTS windows and try again."
            : "WHY: the page did not try to open a window at all (the button did nothing). It may be greyed out or waiting for something; look at the section, then press \"Try again\" below.";
          error.message = `${why} ${error.message}`;
          error.message += ` (RTS messages seen during this run: ${said || "none"}.)`;
        }
        if (!firstFailure) firstFailure = String(error?.message);
        if (!tree || !/Frame with ID|was removed|No tab with id|closed before it reported back/i.test(String(error?.message))) throw error;
        const next = def.rowBy ? null : globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
        if (attempt >= 1) {
          // Two windows went away without reporting. Before calling it a failure, open the window once more only to
          // READ whether the choice is ticked: if RTS did save it, that is a real read-back, not a guess.
          if (next && !next.disabled) {
            try {
              const look = await runInWindow(next, { tree: job.tree, value: job.value, verifyOnly: true }, refind);
              const wanted = job.untick !== true;
              if (look?.status === "verified" && look.checked === wanted) return { status: "savedStateVerified", name: def.key, detail: `${name}: the window kept closing before it could report, but RTS shows the choice ${wanted ? "ticked" : "not ticked"}.` };
            } catch { /* fall through to the original error */ }
          }
          throw error;
        }
        if (!next || next.disabled) throw error;
        // Slower on purpose: each new try waits a little longer, so a window that RTS is still closing or reloading is finished first.
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.retryPause * (attempt + 1)));
        opener = next;
      }
    }
    if (!result) throw new Error(`${name}: the window ended without telling what happened. Check it in RTS.`);
    if (result.status === "skipped") return { status: "skipped", reason: result.reason };

    if (tree) {
      // What the window shows right after Save is not proof: RTS may not have received the save yet (or at all). The
      // window is always opened again and the tick read back from what RTS loads, which is the only real proof.
      if (result.status !== "saved" && result.status !== "windowClosedAfterSave") throw new Error(`${name}: the window ended unexpectedly (${result.status}).`);
      const again = def.rowBy ? null : globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
      if (!again || again.disabled) return { status: "savedStateVerified", name: def.key, detail: "Save was accepted, but the window could not be reopened to read the tick back. Check it in RTS." };
      const check = await runInWindow(again, { tree: job.tree, value: job.value, verifyOnly: true }, refind);
      const wanted = job.untick !== true;
      if (check?.status === "verified" && check.checked === wanted) return { status: "savedValueVerified", name: def.key };
      throw new Error(`${name}: Save was clicked, but when the window was opened again the choice is ${wanted ? "not ticked" : "still ticked"}. Please check it in RTS.`);
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
  // Is the control this mapping starts from on screen (its opening / Add button, else its first field)?
  function controlReady(def) {
    const sb = globalThis.SXRTS.selectorBuilder;
    const button = def.openButton || def.addButton;
    if (button) return Boolean(sb.resolveButtonByDefinition(button));
    return Boolean(def.fields?.[0] && sb.resolveAll(def.fields[0].selectors).some(isShown));
  }

  async function applyCustomField(def, record) {
    // The field may sit in a section RTS shows closed: open sections one at a time, only until its control shows.
    if (!def.rowBy && !controlReady(def)) await globalThis.SXRTS.navigation?.openClosedSections?.(() => controlReady(def));
    // A list of rows (social networks): the row of this record must be on screen. Sections and the left menu are opened until it is.
    if (def.rowBy && record.__row) {
      const rowThere = () => shownIn([def.rowBy.rowSelector]).some((row) => globalThis.SXRTS.selectorBuilder.textHasWord(row.textContent, record.__row));
      if (!rowThere()) await globalThis.SXRTS.navigation?.openClosedSections?.(rowThere);
    }
    if (def.tree && !controlReady(def)) await waitFor(() => controlReady(def), TIMEOUTS.appear); // RTS draws the section a moment after it opens
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

  // Opens the window ONCE and reads whether the choice is ticked (nothing is changed). Used after a person did it by hand.
  async function verifyTree(def, value) {
    const find = () => globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
    const opener = find();
    if (!opener) throw new Error(`The button that opens the window for ${def.label} was not found. Open the Company tab and try again.`);
    const tree = def.window?.tree;
    if (!tree) throw new Error(`${def.label} is not a tree of choices.`);
    const check = await runInWindow(opener, { tree: { expander: tree.expander || null, leaf: tree.leaf }, value: String(value), verifyOnly: true }, find);
    if (check?.status !== "verified") throw new Error(`The window could not be read (${check?.status || "no answer"}).`);
    return { checked: check.checked === true };
  }

  // Opens the Industry window once, opens every branch and reads every choice. Returns lines "Group > Segment > Name (code)".
  async function listTree(def) {
    const find = () => globalThis.SXRTS.selectorBuilder.resolveButtonByDefinition(def.openButton);
    await globalThis.SXRTS.navigation?.openClosedSections?.(() => Boolean(find()));
    const opener = find();
    if (!opener) throw new Error(`The button that opens the window for ${def.label} was not found. Open the Company tab and try again.`);
    const tree = def.window?.tree;
    if (!tree) throw new Error(`${def.label} is not a tree of choices.`);
    await closeStrayWindows();
    const out = await runInWindow(opener, { tree: { expander: tree.expander || null, leaf: tree.leaf }, list: true }, find);
    if (out?.status !== "list") throw new Error(`The window could not be read (${out?.status || "no answer"}).`);
    return out.items.map((item) => `${[...item.path, item.name].join(" > ")}${item.code ? `  (${item.code})` : ""}`);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.customField = { TAG_ATTEMPTS, applyCustomField, rowsOf, TIMEOUTS, runInWindow, verifyTree, listTree, applyTagBoxMany, isTagBoxNow, waitForTagBox };
})();
