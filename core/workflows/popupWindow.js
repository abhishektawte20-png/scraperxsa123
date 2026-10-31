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
  const TIMEOUTS = { fields: 12000, button: 8000, settle: 8000, after: 700, branch: 1500, poll: 40, search: 60000 };

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

  // Through the selector builder, so "sx-label::" selectors resolve too.
  function queryAll(selector) {
    return globalThis.SXRTS.selectorBuilder.matchAll(selector);
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

  // ---- a window that is a tree of checkboxes (for example Industry tagging) ----
  // The tree is a list of "+" buttons that open branches and checkboxes that
  // are the choices. Nothing about its markup is assumed beyond what the
  // researcher picked: a choice is told apart by the text printed next to it,
  // and a branch is opened by clicking its "+" and watching whether more
  // choices appeared (so an already-open branch is closed again, not left shut).
  const SYMBOLS = /^[\s+\-\u2212\u2013\u229E\u229F\u25B6\u25BC\u25BA\u25B8\u25BE]*$/;
  const plain = (value) => String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

  // The first real text after a node in the page: the name printed beside a + or a checkbox.
  function nextText(node) {
    const walker = document.createTreeWalker(document.body, 4);
    walker.currentNode = node;
    let text;
    while ((text = walker.nextNode())) {
      const parent = text.parentElement;
      if (!parent || /^(SCRIPT|STYLE)$/.test(parent.tagName)) continue;
      const value = text.nodeValue.replace(/\s+/g, " ").trim();
      if (value && !SYMBOLS.test(value)) return value;
    }
    return "";
  }

  // The tick boxes and + buttons often are drawn by a sibling, so a control counts when it or its parent is on screen.
  const rendered = (node) => isShown(node) || Boolean(node.parentElement && isShown(node.parentElement));
  function treeShown(selectors) {
    for (const selector of selectors || []) {
      const shown = queryAll(selector).filter(rendered);
      if (shown.length) return shown;
    }
    return [];
  }

  // Is a choice ticked? A real checkbox says so itself. A drawn one (RTS draws div.controls_checkBox) changes
  // its look: it is ticked when its classes differ from the usual, unticked, look of the others.
  const classKey = (node) => `${node.tagName}|${Array.from(node.classList).sort().join(" ")}`;
  function commonKey(selectors) {
    for (const selector of selectors || []) {
      const all = queryAll(selector);
      if (!all.length) continue;
      const counts = new Map();
      for (const node of all) counts.set(classKey(node), (counts.get(classKey(node)) || 0) + 1);
      return Array.from(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
    return "";
  }
  function isTicked(box, leaf) {
    if (box.matches?.("input[type=checkbox]")) return Boolean(box.checked);
    const aria = box.getAttribute?.("aria-checked");
    if (aria === "true" || aria === "false") return aria === "true";
    const base = leaf?.baseKey || commonKey(leaf?.selectors);
    return Boolean(base) && classKey(box) !== base;
  }

  // Every + button of every level: they may carry different ids (RTS: ...Group...Expander and ...Segment...Expander).
  function treeShownAll(selectors) {
    const out = [];
    for (const selector of selectors || []) for (const node of queryAll(selector)) if (rendered(node) && !out.includes(node)) out.push(node);
    return out.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  }

  // The words printed for a choice. RTS puts them in a "...Description" element whose text can be cut up by
  // highlighting; the first text after the box is the fallback.
  function choiceLabel(box) {
    const description = box.id && /CheckBox$/.test(box.id) ? document.getElementById(box.id.replace(/CheckBox$/, "Description")) : null;
    const words = description ? description.textContent.replace(/\s+/g, " ").trim() : "";
    return words || nextText(box);
  }

  // RTS gives every choice its place in its click handler: checkCode(this, sector, group, choice), counted from 0.
  const TUPLE = /\(\s*(?:this\s*,\s*)?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;
  const tupleOf = (box) => { const m = TUPLE.exec(box.getAttribute?.("onclick") || ""); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const wantTuple = (code) => { const p = String(code || "").split(".").map(Number); return p.length === 3 && p.every((n) => Number.isInteger(n) && n >= 1) ? p.map((n) => n - 1) : null; };
  const sameTuple = (a, b) => Boolean(a && b) && a.every((n, i) => n === b[i]);

  // "6.5.1 \u2014 Application Software" -> { code: "6.5.1", name: "Application Software" }
  function parseChoice(value) {
    const text = String(value ?? "").trim();
    const m = /^([\d.]+)\s*[\u2014\u2013-]\s*(.+)$/.exec(text);
    return m ? { code: m[1], name: m[2].trim() } : { code: "", name: text };
  }

  async function treeSettled(count) {
    let last = count();
    let stable = 0;
    const deadline = Date.now() + TIMEOUTS.branch;
    while (stable < 2 && Date.now() < deadline) {
      await wait(TIMEOUTS.poll * 2);
      const now = count();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
  }

  async function findChoice(job, name) {
    const target = plain(name);
    const leaves = () => treeShown(job.tree.leaf.selectors);
    const expanders = () => (job.tree.expander ? treeShownAll(job.tree.expander.selectors) : []);
    const find = () => leaves().filter((leaf) => plain(choiceLabel(leaf)) === target);
    const count = () => leaves().length + expanders().length;
    let hits = find();
    if (hits.length || !job.tree.expander) return hits;

    const keyed = () => {
      const seen = {};
      return expanders().map((node) => {
        const label = nextText(node);
        seen[label] = (seen[label] || 0) + 1;
        return { key: `${label}#${seen[label]}`, node };
      });
    };
    const done = new Set();
    const deadline = Date.now() + TIMEOUTS.search;
    for (let pass = 0; pass < 60; pass++) {
      const fresh = keyed().filter((item) => !done.has(item.key));
      if (!fresh.length) break;
      for (const item of fresh) {
        if (Date.now() > deadline) throw new Error(`Looking for "${name}" in the tree took too long. The list may still be loading; try again.`);
        const live = keyed().find((x) => x.key === item.key);
        if (!live) continue;
        const before = count();
        live.node.click();
        await treeSettled(count);
        done.add(item.key);
        if (count() < before) {
          // It was already open and has just been closed: open it again.
          const again = keyed().find((x) => x.key === item.key);
          if (again) { again.node.click(); await treeSettled(count); }
        }
        hits = find();
        if (hits.length) return hits;
      }
    }
    return [];
  }

  // Names such as "Other" exist under many groups, so the name alone cannot say which is meant.
  // The code can: 6.5.1 is the 6th top-level branch, its 5th group, that group's 1st choice.
  // The choice found that way must still carry the reported name, or nothing is ticked.
  const GENERIC = new Set(["other", "others"]);
  const leftOf = (node) => Math.round(node.getBoundingClientRect().left);
  const after = (a, b) => Boolean(a.compareDocumentPosition(b) & 4);

  async function descendByCode(job, choice) {
    const parts = choice.code.split(".").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 1)) {
      throw new Error(`More than one choice in the tree is called "${choice.name}" and the code "${choice.code || "(none)"}" does not say which. Tick it by hand.`);
    }
    const leaves = () => treeShown(job.tree.leaf.selectors);
    const expanders = () => (job.tree.expander ? treeShownAll(job.tree.expander.selectors) : []);
    const count = () => leaves().length + expanders().length;
    const keyed = () => {
      const seen = {};
      return expanders().map((node) => {
        const label = nextText(node);
        seen[label] = (seen[label] || 0) + 1;
        return { key: `${label}#${seen[label]}`, node };
      });
    };
    const tops = () => {
      const all = keyed();
      if (!all.length) return [];
      const min = Math.min(...all.map((x) => leftOf(x.node)));
      return all.filter((x) => leftOf(x.node) === min);
    };
    // Opens a branch and leaves it open, whichever state it was in.
    async function ensureOpen(key) {
      const item = keyed().find((x) => x.key === key);
      if (!item) throw new Error("A branch of the tree disappeared while it was being opened. Try again.");
      const before = count();
      item.node.click();
      await treeSettled(count);
      if (count() < before) {
        const again = keyed().find((x) => x.key === key);
        if (again) { again.node.click(); await treeSettled(count); }
      }
    }

    const top = tops()[parts[0] - 1];
    if (!top) throw new Error(`The tree has no branch number ${parts[0]}, so "${choice.code}" cannot be found.`);
    await ensureOpen(top.key);

    const topNode = keyed().find((x) => x.key === top.key).node;
    const nextTop = tops().find((x) => after(topNode, x.node));
    const inTop = keyed().filter((x) => after(topNode, x.node) && (!nextTop || after(x.node, nextTop.node)));
    if (!inTop.length) throw new Error(`Branch ${parts[0]} of the tree has no groups, so "${choice.code}" cannot be found.`);
    const groupLeft = Math.min(...inTop.map((x) => leftOf(x.node)));
    const groups = inTop.filter((x) => leftOf(x.node) === groupLeft);
    const group = groups[parts[1] - 1];
    if (!group) throw new Error(`Branch ${parts[0]} of the tree has ${groups.length} group(s), so "${choice.code}" cannot be found.`);
    await ensureOpen(group.key);

    const groupNode = keyed().find((x) => x.key === group.key).node;
    const nextGroup = keyed().find((x) => after(groupNode, x.node) && leftOf(x.node) <= groupLeft);
    const inGroup = leaves().filter((leaf) => after(groupNode, leaf) && (!nextGroup || after(leaf, nextGroup.node)));
    const leaf = inGroup[parts[2] - 1];
    if (!leaf) throw new Error(`Group ${parts[0]}.${parts[1]} of the tree has ${inGroup.length} choice(s), so "${choice.code}" cannot be found.`);
    if (plain(choiceLabel(leaf)) !== plain(choice.name)) {
      throw new Error(`The report says ${choice.code} is "${choice.name}", but RTS lists "${choiceLabel(leaf)}" at that place. Nothing was ticked: check the code and name.`);
    }
    return [leaf];
  }

  // With the place RTS gives a choice (sector, group, choice) and a + button selector per level, the branches are
  // opened by their place, without relying on how the page is laid out. Returns [] when that is not possible.
  async function descendByTuple(job, want) {
    const levels = job.tree.expander?.selectors || [];
    if (!want || levels.length < 2) return [];
    const at = (i) => treeShown([levels[i]]);
    const leaves = () => treeShown(job.tree.leaf.selectors);
    const count = () => leaves().length + at(0).length + at(1).length;
    const open = async (get) => {
      const node = get();
      if (!node) throw new Error(`The tree has no branch at place ${want.map((n) => n + 1).join(".")}.`);
      const before = count();
      node.click();
      await treeSettled(count);
      if (count() < before) { const again = get(); if (again) { again.click(); await treeSettled(count); } }
    };
    await open(() => at(0)[want[0]]);
    const sector = () => at(0)[want[0]];
    const next = () => at(0)[want[0] + 1];
    const groups = () => at(1).filter((n) => after(sector(), n) && (!next() || after(n, next())));
    await open(() => groups()[want[1]]);
    return leaves().filter((l) => sameTuple(tupleOf(l), want));
  }

  function nearbyNames(job, name) {
    const words = plain(name).split(" ").filter((w) => w.length > 3);
    return treeShown(job.tree.leaf.selectors).map(choiceLabel).filter((text) => words.some((w) => plain(text).includes(w))).slice(0, 5);
  }

  // job: { tree: { expander?, leaf }, value, replace?, verifyOnly?, preSave, saveButton }
  async function runTree(job) {
    const choice = parseChoice(job.value);
    if (!choice.name) throw new Error("The report gives no industry name to choose in the tree.");
    const present = await waitFor(() => treeShown(job.tree.leaf.selectors).length || treeShownAll(job.tree.expander?.selectors).length, TIMEOUTS.fields);
    if (!present) throw new Error("The window opened, but its tree of choices was not found. Re-map the field.");

    // The place RTS gives the choice (when it says so) is the surest way: it never confuses two "Other"s.
    const want = wantTuple(choice.code);
    const here = () => treeShown(job.tree.leaf.selectors).filter((l) => sameTuple(tupleOf(l), want));
    let hits = want ? here() : [];
    if (!hits.length) hits = await findChoice(job, choice.name);
    let placed = want ? hits.some((h) => sameTuple(tupleOf(h), want)) && hits.length === 1 : false;
    if (!placed && want && (!hits.length || GENERIC.has(plain(choice.name)) || hits.length > 1)) {
      const byPlace = await descendByTuple(job, want);
      if (byPlace.length === 1) { hits = byPlace; placed = true; }
    }
    if (!placed && (GENERIC.has(plain(choice.name)) || hits.length > 1)) {
      hits = await descendByCode(job, choice);
    }
    // Whatever was found must be where the report says and carry the reported name.
    if (hits.length === 1 && want && sameTuple(tupleOf(hits[0]), want) && plain(choiceLabel(hits[0])) !== plain(choice.name)) {
      throw new Error(`The report says ${choice.code} is "${choice.name}", but RTS lists "${choiceLabel(hits[0])}" at that code. Nothing was ticked: check the code and name.`);
    }
    if (hits.length === 1 && want) {
      const place = tupleOf(hits[0]);
      if (place && !sameTuple(place, want)) throw new Error(`The report says ${choice.code} is "${choice.name}", but RTS lists "${choiceLabel(hits[0])}" at ${place.map((n) => n + 1).join(".")}, not at ${choice.code}. Nothing was ticked: check the code and name.`);
    }
    if (!hits.length) {
      const near = nearbyNames(job, choice.name);
      throw new Error(`"${choice.name}" was not found in the tree of choices${near.length ? ` (similar: ${near.join(", ")})` : ""}. Check the name the report gives against RTS's list.`);
    }
    if (hits.length > 1) throw new Error(`More than one choice in the tree is called "${choice.name}", so the right one cannot be told apart. Tick it by hand.`);
    const box = hits[0];

    if (job.verifyOnly) {
      const checked = isTicked(box, job.tree.leaf);
      window.setTimeout(() => window.close(), 150);
      return { status: "verified", checked };
    }
    if (isTicked(box, job.tree.leaf)) {
      window.setTimeout(() => window.close(), 150);
      return { status: "skipped", reason: `"${choice.name}" is already ticked in RTS.` };
    }

    box.click();
    if (!(await waitFor(() => box.isConnected && isTicked(box, job.tree.leaf), TIMEOUTS.button))) throw new Error(`"${choice.name}" did not stay ticked when it was clicked.`);

    for (const button of job.preSave || []) {
      await waitFor(() => findButton(button), TIMEOUTS.button);
      const target = findButton(button);
      if (!target) throw new Error(`The window's button "${button.text || "(unnamed)"}" that must be pressed before Save was not found.`);
      target.click();
      await wait(TIMEOUTS.after);
    }
    const save = findButton(job.saveButton);
    if (!save) throw new Error("The Save button was not found in the window.");
    if (!(await waitFor(() => !save.disabled, TIMEOUTS.button))) throw new Error("The window's Save button stayed disabled after the box was ticked. RTS may be asking for something else (read the message in the window).");

    report("saveClicked");
    save.click();
    const settled = await waitFor(() => save.disabled || !save.isConnected || !isShown(save), TIMEOUTS.settle);
    if (!settled) throw new Error("Save did not complete in the window: the Save button stayed enabled.");

    // Still here? Then the tick can be read straight away; if the window closed itself, the page reopens it to check.
    const retained = box.isConnected ? isTicked(box, job.tree.leaf) : null;
    window.setTimeout(() => window.close(), 250);
    return { status: "saved", fieldRetained: retained };
  }

  // job: { replace, fields: [{ selectors, kind, value }], preSave: [button], saveButton }
  async function run(job) {
    if (job.tree) return runTree(job);
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
