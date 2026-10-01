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

  function matchesAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function structuralPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 5) {
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
  function buildSelectors(el, { allowMultiple = false } = {}) {
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

    if (allowMultiple) {
      // Row sub-fields: prefer shared class/name selectors over unique ids.
      good.sort((a, b) => Number(a.startsWith("#")) - Number(b.startsWith("#")));
    }

    let fragile = false;
    if (!good.length) {
      const path = structuralPath(el);
      if (path && matchesAll(path).includes(el) && (allowMultiple || matchesAll(path).length === 1)) {
        good.push(path);
        fragile = true;
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

    const { selectors, fragile } = buildSelectors(el, options);
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

  function inspectButton(el) {
    const { selectors, fragile } = buildSelectors(el, {});
    const text = (el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
    return { tag: el.tagName.toLowerCase(), text, selectors, fragile, outerHTML: clip(el.outerHTML) };
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
    resolveFirst, resolveAll, resolveButtonByDefinition, toCamelKey, isStableClass, isStableId
  };
})();
