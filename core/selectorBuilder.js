"use strict";

/*
 * Inspects a picked page element and builds CSS selectors from attributes
 * that are unlikely to change between releases (id, data-test-id, name,
 * aria-label, placeholder, readable class names). Generated CSS-module
 * class hashes (e.g. "flat-button__caption-3fA9x") and state classes are
 * never used. Every candidate is checked against the live DOM before it is
 * returned, so a selector that does not resolve back to the picked element
 * is never offered.
 */
(() => {
  const TEST_ATTRS = ["data-test-id", "data-testid", "data-qa", "data-cy", "data-automation-id"];
  const TEXT_INPUT_TYPES = ["text", "search", "url", "email", "tel", "number", "date", "password"];

  function isStableId(id) {
    return /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && !/^(react|ember|mui|radix|:r)/i.test(id);
  }

  function isStableClass(name) {
    if (!/^[A-Za-z_][\w-]*$/.test(name)) return false;
    if (/^(active|open|opened|selected|focus|focused|hover|disabled|error|invalid|valid|dirty|touched|hidden|show|visible|loading|is-|has-|saved)/i.test(name)) return false;
    // A generated suffix only exists after a separator ("block-3fA9x"); a
    // single camelCase word like "businessEntityName" is a real class name.
    const parts = name.split(/[-_]+/);
    const tail = parts[parts.length - 1];
    const upperCount = (tail.match(/[A-Z]/g) || []).length;
    const looksHashed = parts.length > 1 && tail.length >= 5 && tail.length <= 12 && /^[A-Za-z0-9]+$/.test(tail) && (/\d/.test(tail) || upperCount >= 2);
    return !looksHashed;
  }

  function quote(value) {
    return `"${String(value).replace(/["\\]/g, "\\$&")}"`;
  }

  // A control with no stable attribute is found by the label printed next to
  // it. The pseudo-selector "sx-label::<tag>::<label text>" matches every
  // <tag> whose nearest preceding label text is that text.
  const LABEL_PREFIX = "sx-label::";
  const normText = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const CONTROLS = "input, textarea, select";

  // The text printed just before a control: the closest earlier sibling (of
  // the control or of one of its first few ancestors) that has text and holds
  // no other control.
  function precedingLabelText(el) {
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; node = node.parentElement, depth++) {
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.querySelector(CONTROLS) || prev.matches(CONTROLS)) break;
        const text = (prev.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 80) return text;
      }
    }
    return "";
  }

  function matchesAll(selector, root = document) {
    try {
      if (selector.startsWith(LABEL_PREFIX)) {
        // sx-label::<tag>::<label>[||<n>] — an optional trailing number picks
        // the n-th box (1-based, page order) when several share one label.
        const body = selector.slice(LABEL_PREFIX.length);
        const tag = body.slice(0, body.indexOf("::"));
        const indexed = /\|\|(\d+)$/.exec(body);
        const nth = indexed ? Number(indexed[1]) : 0;
        const want = normText(body.slice(tag.length + 2).replace(/\|\|\d+$/, ""));
        const same = Array.from(root.querySelectorAll(tag)).filter((control) => normText(precedingLabelText(control)) === want);
        return nth ? same.slice(nth - 1, nth) : same;
      }
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function structuralPath(el, maxDepth = 5) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < maxDepth) {
      const tag = node.tagName.toLowerCase();
      if (node.id && isStableId(node.id)) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [node];
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // allowMultiple: sub-fields of a repeatable row legitimately match one
  // element per row, so the selector only has to include the picked one.
  // preferStable: for elements inside a popup or a repeated row, where the
  // same id may be reused by hidden copies. Test attributes (unique by
  // intent) come first, then ids, then the rest.
  function buildSelectors(el, { allowMultiple = false, preferStable = false, labelFallback = false } = {}) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    if (el.id && isStableId(el.id)) candidates.push(`#${el.id}`);
    for (const attr of TEST_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) candidates.push(`[${attr}=${quote(value)}]`);
    }
    for (const attr of ["name", "aria-label", "placeholder", "title"]) {
      const value = el.getAttribute(attr);
      if (value) candidates.push(`${tag}[${attr}=${quote(value)}]`);
    }
    const classes = Array.from(el.classList).filter(isStableClass);
    if (classes.length) {
      candidates.push(`${tag}.${classes.slice(0, 3).join(".")}`);
      for (const name of classes) candidates.push(`${tag}.${name}`);
    }

    const seen = new Set();
    const good = [];
    for (const selector of candidates) {
      if (seen.has(selector)) continue;
      seen.add(selector);
      const found = matchesAll(selector);
      if (!found.includes(el)) continue;
      if (!allowMultiple && found.length !== 1) continue;
      good.push(selector);
    }

    if (preferStable) {
      const rank = (selector) => (selector.startsWith("[data-") ? 0 : selector.startsWith("#") ? 1 : 2);
      good.sort((a, b) => rank(a) - rank(b));
    } else if (allowMultiple) {
      // Row sub-fields: prefer shared class/name selectors over unique ids.
      good.sort((a, b) => Number(a.startsWith("#")) - Number(b.startsWith("#")));
    }

    let fragile = false;
    // Next best: the label printed beside a form control.
    if (!good.length && labelFallback && /^(input|textarea|select)$/.test(tag)) {
      const label = precedingLabelText(el);
      const selector = label ? `${LABEL_PREFIX}${tag}::${label}` : "";
      const found = selector ? matchesAll(selector) : [];
      if (found.includes(el) && (allowMultiple || found.length === 1)) {
        good.push(selector);
      } else if (found.includes(el)) {
        // Several boxes share this label ("Notes:" twice): say which one.
        const indexed = `${selector}||${found.indexOf(el) + 1}`;
        if (matchesAll(indexed)[0] === el) good.push(indexed);
      }
    }
    // Last resort: the element's position, taking more ancestors until it is
    // unique (two identical boxes only differ higher up the page).
    if (!good.length) {
      // The last depth has no limit: a path from the page root always
      // identifies exactly one element.
      for (const depth of [5, 8, 12, 20, Infinity]) {
        const path = structuralPath(el, depth);
        const found = path ? matchesAll(path) : [];
        if (found.includes(el) && (allowMultiple || found.length === 1)) {
          good.push(path);
          fragile = true;
          break;
        }
      }
    }
    return { selectors: good, fragile };
  }

  // The user may click a label, wrapper or icon instead of the control
  // itself; find the single control they most plausibly meant.
  function resolveControl(target) {
    if (!(target instanceof Element)) return null;
    const direct = target.closest("input, select, textarea");
    if (direct) return direct;
    const label = target.closest("label");
    if (label?.control) return label.control;
    const inner = target.querySelectorAll("input:not([type=hidden]), select, textarea");
    if (inner.length === 1) return inner[0];
    return null;
  }

  function resolveButton(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("button, [role=button], input[type=button], input[type=submit], a") || target;
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.id) {
      const forLabel = Array.from(document.querySelectorAll("label")).find((l) => l.htmlFor === el.id);
      if (forLabel?.textContent.trim()) return forLabel.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.textContent.trim()) return wrapping.textContent.trim();
    const container = el.closest('[class*="field"], [class*="form-group"], [class*="control"], tr, li, div');
    const nearby = container?.querySelector("label, .label, [class*=label]");
    if (nearby && !nearby.contains(el) && nearby.textContent.trim()) return nearby.textContent.trim().slice(0, 60);
    return el.getAttribute("placeholder") || el.getAttribute("name") || "";
  }

  // "Founded year" -> foundedYear; words that are already camelCase
  // ("emailDefaultStructure") keep their inner capitals.
  function toCamelKey(text) {
    const words = String(text).replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    if (!words.length) return "";
    const key = words.map((word, i) => {
      const keepInner = /[a-z][A-Z]/.test(word);
      const rest = keepInner ? word.slice(1) : word.slice(1).toLowerCase();
      return (i === 0 ? word[0].toLowerCase() : word[0].toUpperCase()) + rest;
    }).join("");
    return /^[a-z]/.test(key) ? key.slice(0, 40) : `field${key}`.slice(0, 40);
  }

  function isCustomDropdown(el) {
    const role = el.getAttribute("role");
    return role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox" || el.hasAttribute("aria-autocomplete");
  }

  function clip(html) {
    return html.length > 4000 ? `${html.slice(0, 4000)}...` : html;
  }

  // Describes a picked form control. kind is "text", "select", or
  // "unsupported" (with a plain-language reason).
  function inspectControl(el, options = {}) {
    const base = { tag: el.tagName.toLowerCase(), label: labelFor(el), outerHTML: clip(el.outerHTML) };
    base.suggestedKey = toCamelKey(base.label);

    if (isCustomDropdown(el)) {
      return { ...base, kind: "unsupported", reason: "This looks like a custom (searchable) dropdown, not a native one. Only text boxes and native dropdowns are supported so far." };
    }
    let kind;
    if (el instanceof HTMLSelectElement) kind = "select";
    else if (el instanceof HTMLTextAreaElement) kind = "text";
    else if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.includes((el.type || "text").toLowerCase())) kind = "text";
    else {
      return { ...base, kind: "unsupported", reason: `A ${el.tagName.toLowerCase()}${el.type ? ` (${el.type})` : ""} control is not supported yet. Pick a text box or a native dropdown.` };
    }
    if (el.disabled || el.readOnly) {
      return { ...base, kind: "unsupported", reason: "This field is disabled or read-only right now. Make it editable on the page, then pick it again." };
    }

    if (el.getRootNode?.() !== document) {
      return { ...base, kind: "unsupported", reason: "This field sits inside an embedded frame or a hidden shadow area of the page, which the extension cannot reach from here." };
    }
    const { selectors, fragile } = buildSelectors(el, { ...options, labelFallback: true });
    if (!selectors.length) {
      return { ...base, kind: "unsupported", reason: "No reliable selector could be built for this field (it has no stable id, name or class)." };
    }
    const result = { ...base, kind, selectors, fragile };
    if (kind === "select") {
      result.options = Array.from(el.options)
        .filter((o) => o.textContent.trim() && o.value !== "")
        .map((o) => ({ label: o.textContent.trim(), value: o.value }));
      if (!result.options.length) {
        return { ...base, kind: "unsupported", reason: "This dropdown has no options loaded yet. Open the section so its options load, then pick it again." };
      }
    }
    return result;
  }

  // options.allowMultiple / preferStable: see buildSelectors. A button that
  // exists once per row ("New" in every network row) must be allowed to
  // match all of them.
  function inspectButton(el, options = {}) {
    const { selectors, fragile } = buildSelectors(el, options);
    const text = (el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
    return { tag: el.tagName.toLowerCase(), text, selectors, fragile, outerHTML: clip(el.outerHTML) };
  }

  // Rows that repeat a button. Climbs from the picked button until the
  // container would hold another button with the same label; the last node
  // below that is one row. Returns the row element plus a selector that
  // matches every row, or null when the rows cannot be told apart.
  function inspectRow(button, buttonSelectors) {
    const labelOf = (node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ");
    const same = buttonSelectors.flatMap((selector) => matchesAll(selector))
      .filter((node, i, all) => all.indexOf(node) === i && labelOf(node) === labelOf(button));
    let row = null;
    if (same.length >= 2) {
      for (let node = button; node.parentElement && node !== document.body; node = node.parentElement) {
        if (same.some((other) => other !== button && node.parentElement.contains(other))) { row = node; break; }
      }
    } else {
      row = button.closest("tr, li") || button.parentElement;
    }
    if (!row) return null;
    const tag = row.tagName.toLowerCase();
    const candidates = [];
    const classes = Array.from(row.classList).filter(isStableClass);
    if (classes.length) candidates.push(`${tag}.${classes.slice(0, 3).join(".")}`, ...classes.map((c) => `${tag}.${c}`));
    if (row.parentElement) {
      const parent = buildSelectors(row.parentElement, {}).selectors[0];
      if (parent) candidates.push(`${parent} > ${tag}`);
    }
    for (const selector of candidates) {
      const found = matchesAll(selector);
      if (found.includes(row) && found.length >= Math.min(2, same.length || 2)) return { row, selector, count: found.length };
    }
    return null;
  }

  // Whole-word, case-insensitive match of a row's label inside the row text.
  function textHasWord(text, word) {
    const clean = (value) => ` ${String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const target = clean(word).trim();
    return Boolean(target) && clean(text).includes(` ${target} `);
  }

  function resolveFirst(selectors) {
    for (const selector of selectors || []) {
      const found = matchesAll(selector)[0];
      if (found) return found;
    }
    return null;
  }

  function resolveAll(selectors) {
    for (const selector of selectors || []) {
      const found = matchesAll(selector);
      if (found.length) return found;
    }
    return [];
  }

  // Buttons also fall back to their exact visible text when no selector
  // resolves, since a button's label is often more stable than its markup.
  function resolveButtonByDefinition(button) {
    const bySelector = resolveFirst(button?.selectors);
    if (bySelector) return bySelector;
    if (!button?.text) return null;
    return Array.from(document.querySelectorAll("button, [role=button], input[type=button], input[type=submit], a"))
      .find((node) => (node.textContent || node.value || "").trim().replace(/\s+/g, " ") === button.text) || null;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.selectorBuilder = {
    buildSelectors, resolveControl, resolveButton, inspectControl, inspectButton,
    resolveFirst, resolveAll, resolveButtonByDefinition, toCamelKey, isStableClass, isStableId, inspectRow, textHasWord, matchAll: matchesAll, LABEL_PREFIX
  };
})();
