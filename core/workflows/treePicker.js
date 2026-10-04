"use strict";

/*
 * Adds a NAICS code through RTS's "Select NAICS" dialog: a tree of sectors,
 * sub-sectors, industry groups and industries whose last level is a radio
 * button labelled "111110 – Soybean Farming". The dialog's own data is the
 * source of truth: the code is found by opening the right branches, so no
 * NAICS table is bundled. Every step confirms itself against the page.
 *
 * Finding the code: the sector comes from the first two digits of the code.
 * Inside it, sub-sectors are in code order, so a binary search opens one whole
 * sub-sector at a time and compares the codes it reveals with the target.
 * "Inside" a branch is decided by document order (a node's children follow it
 * in the page), so no assumption is made about how the tree is nested.
 */
(() => {
  // Exposed so tests do not have to sit through the real waits.
  const TIMEOUTS = { open: 5000, settle: 1500, choose: 1500, button: 3000, save: 8000, section: 5000, poll: 40, search: 90000 };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return true;
      await wait(TIMEOUTS.poll);
    }
    return Boolean(check());
  }

  // Chrome's own visibility check is fast, which matters here: a tree has
  // hundreds of nodes and they are tested over and over while it is searched.
  function isShown(node) {
    if (typeof node.checkVisibility === "function") return node.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.style?.display === "none" || current.style?.visibility === "hidden") return false;
    }
    return true;
  }

  const sb = () => globalThis.SXRTS.selectorBuilder;
  const BUTTONS = "button, [role=button], input[type=button], input[type=submit], a";
  const labelOf = (node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ");
  const plain = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const isEnabled = (button) => Boolean(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true";

  function shownMatches(selectors, root, visible = isShown) {
    for (const selector of selectors || []) {
      const shown = sb().matchAll(selector, root).filter(visible);
      if (shown.length) return shown;
    }
    return [];
  }

  // b follows a in the page; node is inside the span from start up to end.
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & 4);
  const inScope = (node, start, end) => follows(start, node) && (!end || follows(node, end));

  // The 20 NAICS sectors, in the order (and with the names) RTS lists them.
  const SECTORS = [
    { codes: ["11"], name: "Agriculture, Forestry, Fishing and Hunting" },
    { codes: ["21"], name: "Mining, Quarrying, and Oil and Gas Extraction" },
    { codes: ["22"], name: "Utilities" },
    { codes: ["23"], name: "Construction" },
    { codes: ["31", "32", "33"], name: "Manufacturing" },
    { codes: ["42"], name: "Wholesale Trade" },
    { codes: ["44", "45"], name: "Retail Trade" },
    { codes: ["48", "49"], name: "Transportation and Warehousing" },
    { codes: ["51"], name: "Information" },
    { codes: ["52"], name: "Finance and Insurance" },
    { codes: ["53"], name: "Real Estate and Rental and Leasing" },
    { codes: ["54"], name: "Professional, Scientific, and Technical Services" },
    { codes: ["55"], name: "Management of Companies and Enterprises" },
    { codes: ["56"], name: "Administrative and Support and Waste Management and Remediation Services" },
    { codes: ["61"], name: "Educational Services" },
    { codes: ["62"], name: "Health Care and Social Assistance" },
    { codes: ["71"], name: "Arts, Entertainment, and Recreation" },
    { codes: ["72"], name: "Accommodation and Food Services" },
    { codes: ["81"], name: "Other Services (except Public Administration)" },
    { codes: ["92"], name: "Public Administration" }
  ];

  // The + and radio inputs are often hidden visually and drawn by a sibling,
  // so an input counts when it, or the thing around it, is on screen.
  const rendered = (node) => isShown(node) || Boolean(node.parentElement && isShown(node.parentElement));
  const expanders = (def) => shownMatches(def.tree.expander.selectors, undefined, rendered);
  const radios = (def) => shownMatches(def.tree.leaf.selectors, undefined, rendered);

  function isExpanded(expander) {
    const label = expander.getAttribute("aria-label");
    return label ? /^collapse/i.test(label) : Boolean(expander.checked);
  }

  const expanderName = (expander) => (expander.getAttribute("aria-label") || "").replace(/^(expand|collapse)\s+/i, "");

  // The text shown for a choice: the first ancestor with text of its own.
  function leafText(radio) {
    let node = radio;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      // Text only: a radio's own value ("on") is not what the page shows.
      const text = (node.textContent || "").trim().replace(/\s+/g, " ");
      if (text) return text;
    }
    return "";
  }
  const codeOf = (radio) => /^\s*(\d{6})(?!\d)/.exec(leafText(radio))?.[1] ?? null;

  // Waits for the tree to stop changing after a click (React renders late).
  async function settled(def) {
    const snapshot = () => `${expanders(def).length}/${radios(def).length}`;
    let last = snapshot();
    let stable = 0;
    const deadline = Date.now() + TIMEOUTS.settle;
    while (stable < 2 && Date.now() < deadline) {
      await wait(TIMEOUTS.poll * 2);
      const now = snapshot();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
  }

  // Branches are tracked by name, not by element: if the page redraws the whole
  // tree after a click, the elements are new but the names are the same.
  const byName = (def, name, from, to) => expanders(def).find((e) => expanderName(e) === name && (!from || follows(from, e)) && (!to || follows(e, to)));

  async function expandOne(def, get) {
    const expander = get();
    if (expander && expander.isConnected && !isExpanded(expander)) {
      expander.click();
      await settled(def);
    }
  }

  // Opens every closed branch between two points, until none is left.
  async function expandAllIn(def, getStart, getEnd, guard = () => {}) {
    for (let pass = 0; pass < 500; pass++) {
      guard();
      const start = getStart();
      if (!start) return;
      const end = getEnd();
      const closed = expanders(def).filter((e) => inScope(e, start, end) && !isExpanded(e));
      if (!closed.length) return;
      for (const expander of closed) if (expander.isConnected && !isExpanded(expander)) expander.click();
      await settled(def);
    }
  }

  async function collapseAll(def) {
    for (let pass = 0; pass < 6; pass++) {
      const open = expanders(def).filter(isExpanded).reverse();
      if (!open.length) return;
      for (const expander of open) if (expander.isConnected && isExpanded(expander)) expander.click();
      await settled(def);
    }
  }

  function pickSector(tops, code) {
    const sector = SECTORS.find((s) => s.codes.includes(code.slice(0, 2)));
    if (!sector) throw new Error(`${code} does not start with a NAICS sector number (11 to 92).`);
    const byName = tops.find((e) => plain(expanderName(e)) === plain(sector.name));
    if (byName) return byName;
    if (tops.length === SECTORS.length) return tops[SECTORS.indexOf(sector)];
    throw new Error(`The sector "${sector.name}" was not found in RTS's NAICS list.`);
  }

  async function findRadio(def, code) {
    // A tree that never stops changing must not hold the researcher up forever.
    const deadline = Date.now() + TIMEOUTS.search;
    const guard = () => {
      if (Date.now() > deadline) throw new Error(`Looking for NAICS ${code} in the dialog took too long. The list may be loading; try again.`);
    };
    const visible = () => radios(def).find((r) => codeOf(r) === code);
    if (visible()) return visible();

    await collapseAll(def);
    const tops = expanders(def);
    if (!tops.length) throw new Error("The NAICS dialog shows no + buttons to open.");
    const top = pickSector(tops, code);
    const topName = expanderName(top);
    const nextTop = tops[tops.indexOf(top) + 1];
    const nextName = nextTop ? expanderName(nextTop) : null;
    const getTop = () => byName(def, topName);
    const getEnd = () => (nextName ? byName(def, nextName, getTop()) : null);

    await expandOne(def, getTop);
    if (visible()) return visible();

    const subNames = expanders(def).filter((e) => inScope(e, getTop(), getEnd())).map(expanderName);
    const tried = new Set();
    const inspect = async (index) => {
      const getSub = () => byName(def, subNames[index], getTop(), getEnd());
      const getSubEnd = () => (index + 1 < subNames.length ? byName(def, subNames[index + 1], getTop(), getEnd()) : getEnd());
      tried.add(index);
      await expandOne(def, getSub);
      await expandAllIn(def, getSub, getSubEnd, guard);
      const sub = getSub();
      const leaves = sub ? radios(def).filter((r) => inScope(r, sub, getSubEnd())) : [];
      return { hit: leaves.find((r) => codeOf(r) === code), codes: leaves.map(codeOf).filter(Boolean).sort() };
    };

    // Sub-sectors are in code order: open the middle one whole and compare.
    let lo = 0;
    let hi = subNames.length - 1;
    while (lo <= hi) {
      guard();
      const mid = (lo + hi) >> 1;
      const { hit, codes } = await inspect(mid);
      if (hit) return hit;
      if (!codes.length) break;
      if (codes[codes.length - 1] < code) lo = mid + 1;
      else if (codes[0] > code) hi = mid - 1;
      else break;
    }
    // The order was not what was expected: look through the rest one by one.
    for (let index = 0; index < subNames.length; index++) {
      if (tried.has(index)) continue;
      guard();
      const { hit } = await inspect(index);
      if (hit) return hit;
    }
    throw new Error(`NAICS code ${code} is not in RTS's list. Check the code.`);
  }

  // While mapping: open branches (first closed + first, again and again) until
  // a radio button shows, so the researcher has a code to point at without
  // having to click inside the dialog through the mapping window.
  async function revealLeaf(def) {
    const probe = { tree: { expander: def.tree.expander, leaf: { selectors: ["input[type=radio]"] } } };
    const hasRadio = () => radios(probe).length > 0;
    for (let pass = 0; pass < 12 && !hasRadio(); pass++) {
      const next = expanders(probe).find((e) => !isExpanded(e));
      if (!next) break;
      next.click();
      await settled(probe);
    }
    return hasRadio();
  }

  // The section that holds this opener. Its own Save Changes sits next to the
  // Add button, but the list of codes may sit above them, outside that row; so
  // the section is the largest ancestor that still holds only one Save Changes.
  function scopeFor(opener, sectionSave) {
    const saves = (node) => Array.from(node.querySelectorAll(BUTTONS)).filter((b) => isShown(b) && labelOf(b) === (sectionSave.text || ""));
    for (let node = opener?.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const save = shownMatches(sectionSave.selectors, node).find((b) => !sectionSave.text || labelOf(b) === sectionSave.text);
      if (!save) continue;
      let root = node;
      if (sectionSave.text) {
        while (root.parentElement && root.parentElement !== document.body && saves(root.parentElement).length === 1) root = root.parentElement;
      }
      return { root, save };
    }
    return null;
  }

  function findOpener(def) {
    const { selectors, text } = def.openButton;
    for (const selector of selectors || []) {
      const hit = sb().matchAll(selector).find((n) => isShown(n) && (!text || labelOf(n) === text));
      if (hit) return hit;
    }
    return text ? Array.from(document.querySelectorAll(BUTTONS)).find((n) => isShown(n) && labelOf(n) === text) || null : null;
  }

  function findDialogSave(def) {
    const { selectors, text } = def.saveButton;
    const bySelector = shownMatches(selectors)[0];
    if (bySelector) return bySelector;
    return text ? Array.from(document.querySelectorAll(BUTTONS)).find((n) => isShown(n) && labelOf(n) === text) || null : null;
  }

  async function apply(def, record) {
    const raw = record.code;
    if (raw === null || raw === undefined || String(raw).trim() === "") return { status: "skipped", reason: "no value proposed" };
    const code = /^\s*(\d{6})(?!\d)/.exec(String(raw))?.[1];
    if (!code) throw new Error(`"${raw}" is not a 6-digit NAICS code.`);

    const opener = findOpener(def);
    if (!opener) throw new Error(`The "${def.openButton.text || "Add"}" button was not found on this page. Open the Industry Classification section, or re-map the field.`);
    const scope = scopeFor(opener, def.tree.sectionSave);
    if (!scope) throw new Error("The section's Save Changes button was not found next to the Add button. Re-map the field.");
    if (plain(scope.root.textContent).includes(code)) {
      return { status: "skipped", reason: "duplicate", detail: `NAICS ${code} is already in this section.` };
    }

    // The dialog may already be open (left open by the researcher).
    if (!expanders(def).length) {
      if (!isEnabled(opener)) throw new Error(`The "${def.openButton.text || "Add"}" button is disabled right now.`);
      opener.click();
      if (!(await waitFor(() => expanders(def).length > 0, TIMEOUTS.open))) {
        throw new Error(`The NAICS dialog did not open after clicking "${def.openButton.text || "the button"}".`);
      }
    }

    const radio = await findRadio(def, code);
    radio.scrollIntoView?.({ block: "center" });
    radio.click();
    if (!(await waitFor(() => radio.checked, TIMEOUTS.choose))) throw new Error(`RTS did not select ${code} in the dialog.`);

    const dialogSave = findDialogSave(def);
    if (!dialogSave) throw new Error("The NAICS dialog's Save button was not found. Re-map the field.");
    if (!(await waitFor(() => isEnabled(dialogSave), TIMEOUTS.button))) throw new Error(`The dialog's Save button stayed disabled after choosing ${code}.`);
    dialogSave.click();
    if (!(await waitFor(() => !expanders(def).length && !radios(def).length, TIMEOUTS.save))) {
      throw new Error(`The NAICS dialog stayed open after Save, so ${code} was not accepted.`);
    }

    const current = () => scopeFor(findOpener(def), def.tree.sectionSave);
    if (!(await waitFor(() => { const s = current(); return Boolean(s) && isEnabled(s.save); }, TIMEOUTS.section))) {
      throw new Error(`The section's Save Changes did not become active after choosing ${code}, so RTS may not have registered it.`);
    }
    current().save.click();
    if (!(await waitFor(() => { const s = current(); return !s || !isEnabled(s.save); }, TIMEOUTS.save))) {
      throw new Error(`Save Changes did not complete for NAICS ${code}: the button never went back to inactive.`);
    }

    const after = current();
    if (after && plain(after.root.textContent).includes(code)) return { status: "savedValueVerified", name: code };
    return {
      status: "savedStateVerified",
      name: code,
      detail: `Saved. The section does not list ${code} on the page, so the code itself could not be read back; check the NAICS list in RTS.`
    };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.treePicker = { apply, findRadio, revealLeaf, scopeFor, isOpen: (def) => expanders(def).length > 0, SECTORS, TIMEOUTS };
})();
