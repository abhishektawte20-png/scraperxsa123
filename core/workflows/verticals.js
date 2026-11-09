"use strict";

/*
 * Company > Verticals. Built in, nothing to map: the section is found by its printed words ("Published Verticals",
 * "Add New Vertical"), and so are the True buttons in the window it opens.
 *
 *   1. The verticals already listed under "Published Verticals" are reported as already in RTS and left alone.
 *   2. For the rest, "Add New Vertical" opens the window; each vertical is found by name (in the Recommended or the
 *      Other list) and its True button is pressed; the window is closed.
 *   3. The section's own "Save changes" is pressed once.
 *   4. A vertical counts as saved only when it is listed under "Published Verticals" afterwards.
 * TMT and Industrials are system-managed and are never assigned.
 */
(() => {
  const TIMEOUTS = { open: 4000, enable: 8000, save: 12000, list: 10000 };
  const SYSTEM_MANAGED = new Set(["tmt", "industrials"]);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const plain = (text) => String(text ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const shown = (node) => (typeof node.checkVisibility === "function" ? node.checkVisibility() : true);

  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (check()) return true; await wait(50); }
    return Boolean(check());
  }

  const buttons = () => Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], [role=button]"));
  const labelOf = (node) => squash(node.value || node.textContent);
  const findAdd = () => buttons().find((node) => labelOf(node).toLowerCase() === "add new vertical" && shown(node)) || null;

  // The block that holds the Published / Recommended lists, the Add button and the section's Save changes.
  function sectionOf(add) {
    for (let node = add.parentElement; node; node = node.parentElement) if (/published verticals/i.test(node.textContent || "")) return node;
    return add.parentElement;
  }

  // The names under "Published Verticals": the text between that heading and "Recommended Verticals".
  function publishedText(section) {
    const text = squash(section.textContent);
    const start = text.search(/published verticals/i);
    if (start < 0) return "";
    const rest = text.slice(start).replace(/^published verticals\s*(\(\d+\))?/i, "");
    const end = rest.search(/recommended verticals/i);
    return plain(end >= 0 ? rest.slice(0, end) : rest);
  }
  const listed = (section, name) => ` ${publishedText(section)} `.includes(` ${plain(name)} `);

  // The section's own "Save changes" sits just below it: the first one that comes after the Add button on the page.
  function saveButtonOf(add) {
    return buttons().find((node) => /^save changes$/i.test(labelOf(node)) && Boolean(add.compareDocumentPosition(node) & 4)) || null;
  }

  // names: ["AdTech", ...]. Returns { results: { [name]: { status, detail } } } with status
  // savedValueVerified | skipped | failed. Never throws for one vertical; throws only when the section is not there at all.
  async function applyVerticals(names) {
    const results = {};
    const wanted = Array.from(new Set(names.map(squash).filter(Boolean)));
    let add = findAdd();
    if (!add) {
      await globalThis.SXRTS.navigation?.ensureSectionOpen(() => findAdd(), ["Industries and Verticals", "Verticals"]);
      add = findAdd();
    }
    if (!add) throw new Error('The "Add New Vertical" button was not found. Open the Company tab and its Industries and Verticals section, then publish again.');
    let section = sectionOf(add);

    const todo = [];
    for (const name of wanted) {
      if (SYSTEM_MANAGED.has(plain(name))) results[name] = { status: "skipped", detail: `${name} is system-managed and is never assigned.` };
      else if (listed(section, name)) results[name] = { status: "skipped", detail: `${name} is already in the Published Verticals list.` };
      else todo.push(name);
    }
    if (!todo.length) return { results };
    if (add.disabled) throw new Error('The "Add New Vertical" button is disabled right now.');

    const customField = globalThis.SXRTS.workflows.customField;
    let outcome;
    for (let attempt = 0; ; attempt++) {
      try { outcome = await customField.runInWindow(add, { rows: { names: todo, trueText: "True" } }); break; } catch (error) {
        if (attempt >= 1 || !/Frame with ID|was removed|No tab with id|closed before it reported back/i.test(String(error?.message))) throw error;
        await wait(1200);
        add = findAdd() || add;
      }
    }
    for (const name of outcome?.missing ?? []) results[name] = { status: "failed", detail: `${name} was not found (or is listed more than once) in RTS's list of verticals. Check the name.` };
    for (const name of outcome?.already ?? []) results[name] = { status: "skipped", detail: `${name} is already chosen (True) in RTS.` };
    const pressed = [...(outcome?.clicked ?? []), ...(outcome?.already ?? [])];
    if (!pressed.length) return { results };

    // Back on the page: the section's Save changes wakes up once something was chosen.
    add = findAdd() || add;
    section = sectionOf(add);
    const save = saveButtonOf(add);
    if (save) {
      if (await waitFor(() => !save.disabled, TIMEOUTS.enable)) {
        save.click();
        await waitFor(() => save.disabled || !save.isConnected, TIMEOUTS.save);
      }
    }
    for (const name of pressed) {
      if (results[name]) continue;
      const ok = await waitFor(() => listed(sectionOf(findAdd() || add), name), TIMEOUTS.list);
      results[name] = ok
        ? { status: "savedValueVerified", detail: `${name} is now in the Published Verticals list.` }
        : { status: "failed", detail: `True was pressed for ${name}${save ? " and Save changes was pressed" : ""}, but ${name} is not in the Published Verticals list afterwards. Check the section in RTS.` };
    }
    return { results };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.verticals = { applyVerticals, TIMEOUTS, SYSTEM_MANAGED, publishedText };
})();
