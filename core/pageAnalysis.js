"use strict";

/*
 * Analyze page. Reads the part of the RTS page you are looking at (or the open dialog / window) and lists
 * every control that matters: text boxes, dropdowns, buttons, tick boxes, with the words printed next to them,
 * whether they are required, the choices of a dropdown, and how the extension can find them again. Boxes are
 * grouped by the form or section they sit in, and each is matched, by its words, to the report field it most
 * likely fills.
 *
 * It only READS the page. Nothing is typed, chosen or saved.
 */
(() => {
  const sb = () => globalThis.SXRTS.selectorBuilder;
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const MAX_ITEMS = 400;

  function isShown(node) {
    if (typeof node.checkVisibility === "function") return node.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.style?.display === "none" || current.style?.visibility === "hidden") return false;
    }
    return true;
  }
  // A drawn tick box / + button is often hidden and its sibling shown.
  const rendered = (node) => isShown(node) || Boolean(node.parentElement && isShown(node.parentElement));

  // ---- the open dialog, if there is one ----
  const LAYERS = '[role=dialog], dialog[open], [aria-modal="true"], [class*="modal" i], [class*="dialog" i], [class*="popup" i], [class*="overlay" i]';
  const CONTROLS = 'input:not([type=hidden]), select, textarea, button, [role=button], a[onclick]';
  function topLayer(doc) {
    const found = Array.from(doc.querySelectorAll(LAYERS)).filter((n) => isShown(n) && n.querySelector(CONTROLS) && !n.closest("#sxrts-assistant-root"));
    // The last one in the page is the one opened most recently; skip a layer that only wraps another.
    const inner = found.filter((n) => !found.some((m) => m !== n && n.contains(m)));
    return inner.length ? inner[inner.length - 1] : null;
  }

  // ---- words for a region ----
  function titleOf(region) {
    if (!region || region === region.ownerDocument.body) return "Page";
    const heading = region.querySelector('h1, h2, h3, h4, h5, legend, [class*="title" i], [class*="header" i], [class*="head" i]');
    const own = squash(heading?.textContent);
    if (own && own.length <= 60) return own;
    const before = region.previousElementSibling;
    const prev = squash(before?.textContent);
    if (prev && prev.length <= 40) return prev;
    return region.id ? region.id : region.tagName.toLowerCase();
  }
  // The form or dialog first, then a titled section; a bare table only when nothing bigger holds the box.
  const regionOf = (node, root) => node.closest("form, [role=dialog]") || node.closest("fieldset, [id^=block], section") || node.closest("table") || (root && root.contains(node) ? root : node.ownerDocument.body);

  // The words printed beside a box that has no <label>: the cell before it in a table row, the element just before
  // it, or the cell / block before the one it sits in.
  function nearbyLabel(node) {
    const text = (el) => { const t = squash(el?.textContent); return t && t.length <= 60 && !el.querySelector?.("input, select, textarea, button") ? t : ""; };
    const cell = node.closest("td, th");
    if (cell?.previousElementSibling) { const t = text(cell.previousElementSibling); if (t) return t; }
    for (let el = node.previousElementSibling; el; el = el.previousElementSibling) { const t = text(el); if (t) return t; if (/^(input|select|textarea)$/i.test(el.tagName)) break; }
    const prevText = node.previousSibling && node.previousSibling.nodeType === 3 ? squash(node.previousSibling.nodeValue) : "";
    if (prevText && prevText.length <= 60) return prevText;
    const holder = node.parentElement;
    if (holder?.previousElementSibling) { const t = text(holder.previousElementSibling); if (t) return t; }
    return "";
  }

  // ---- what a control is ----
  function describe(node) {
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute("type") || (tag === "input" ? "text" : "")).toLowerCase();
    if (tag === "button" || type === "button" || type === "submit" || type === "image" || node.getAttribute("role") === "button" || (tag === "a" && node.hasAttribute("onclick"))) {
      const info = sb().inspectButton(node, {});
      const text = squash(node.value || node.textContent || node.getAttribute("aria-label") || node.title);
      return { kind: "button", label: text, selectors: info.selectors || [], text: info.text || text, disabled: Boolean(node.disabled) || node.getAttribute("aria-disabled") === "true", mappable: false };
    }
    if (type === "checkbox" || type === "radio") {
      const near = sb().inspectControl(node, {});
      const named = squash(near.label);
      return { kind: type, label: (!named || named === node.getAttribute("name") || named === node.id ? nearbyLabel(node) : named) || named || squash(node.getAttribute("aria-label")), selectors: near.selectors || [], mappable: false, reason: "Tick boxes and round buttons are not filled by a taught form yet." };
    }
    const info = sb().inspectControl(node, {});
    let label = squash(info.label);
    // inspectControl falls back to the box's name or id when nothing is printed for it: look at the words around it.
    if (!label || label === node.getAttribute("name") || label === node.id) label = nearbyLabel(node) || label;
    const required = /\*\s*$/.test(label) || node.required || node.getAttribute("aria-required") === "true";
    const base = { label: label.replace(/\s*\*\s*$/, ""), required, selectors: info.selectors || [], needsLabel: Boolean(info.needsLabel), disabled: Boolean(node.disabled || node.readOnly) };
    if (info.kind === "unsupported") return { ...base, kind: tag === "select" ? "select" : "text", mappable: false, reason: info.reason };
    return { ...base, kind: info.kind, mappable: true, ...(info.options ? { options: info.options } : {}) };
  }

  // ---- which report field does a box fill? ----
  const SYNONYMS = {
    fullName: ["full name", "person name", "contact name"], firstName: ["first name", "given name"], lastName: ["last name", "surname", "family name"],
    title: ["title", "position", "job title", "role", "designation"], value: [], code: ["code"], network: ["network", "platform"], handleOrUrl: ["handle", "url", "link", "profile", "identifier"],
    city: ["city", "town"], state: ["state", "province", "region"], country: ["country"], postcode: ["zip", "postal", "postcode", "pin code"],
    phone: ["phone", "telephone", "tel", "mobile"], fax: ["fax"], siteEmail: ["email", "e mail", "mail"], address: ["address", "street"], startDate: ["start date", "founded", "established"],
    employeeCount: ["employees", "employee count", "headcount"]
  };
  const words = (text) => squash(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // The report fields (path + key) a box could fill, from the report's own field list.
  function targetsList() {
    const out = [];
    for (const field of globalThis.SXRTS.outputFields?.FIELDS ?? []) for (const k of field.keys ?? []) out.push({ path: field.path, key: k.key, label: field.keys.length > 1 ? `${field.label} — ${k.label}` : field.label, fieldLabel: field.label, kind: field.kind });
    return out;
  }

  // Best report key of ONE field for a box label (null when nothing is close).
  function suggestKey(label, field) {
    const text = words(label);
    if (!text) return null;
    let best = null;
    let bestScore = 0;
    for (const k of field.keys ?? []) {
      const names = [words(k.label), words(k.key.replace(/([a-z])([A-Z])/g, "$1 $2")), ...(SYNONYMS[k.key] ?? []).map(words)];
      let score = 0;
      for (const name of names) {
        if (!name) continue;
        if (text === name) score = Math.max(score, 3);
        else if (` ${text} `.includes(` ${name} `)) score = Math.max(score, 2);
        else if (name.split(" ").some((w) => w.length > 2 && text.split(" ").includes(w))) score = Math.max(score, 1);
      }
      if (score > bestScore) { best = k.key; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
  }

  // The whole report field a set of box labels most likely belongs to.
  function suggestField(labels) {
    let best = null;
    let bestScore = 0;
    for (const field of globalThis.SXRTS.outputFields?.FIELDS ?? []) {
      if (field.picker || field.path === "extras.industryCode") continue;
      const hits = new Set(labels.map((l) => suggestKey(l, field)).filter(Boolean));
      const score = hits.size * 10 + (field.kind === "list" ? 1 : 0);
      if (hits.size && score > bestScore) { best = field.path; bestScore = score; }
    }
    return best;
  }

  /*
   * scan({ root?, scope: "auto" | "page" | "window" }) -> { scope, note, regions: [{ title, items: [...] }], buttons: [...], count }
   * "auto" reads the open dialog when there is one, otherwise the page.
   */
  function scan({ root, scope = "auto" } = {}) {
    const doc = (root || document).ownerDocument || document;
    const layer = scope === "page" ? null : topLayer(doc);
    const base = root || layer || doc.body;
    const used = layer && !root ? "window" : "page";
    const regions = new Map();
    const buttons = [];
    let count = 0;
    for (const node of Array.from(base.querySelectorAll(CONTROLS))) {
      if (count >= MAX_ITEMS) break;
      if (node.closest("#sxrts-assistant-root, [id^=sx-test-root]")) continue;
      const type = (node.getAttribute("type") || "").toLowerCase();
      if (!(type === "checkbox" || type === "radio" ? rendered(node) : isShown(node))) continue;
      let item;
      try { item = describe(node); } catch { continue; }
      item.id = count++;
      item.element = node;
      if (item.kind === "button") { buttons.push(item); }
      const region = regionOf(node, base);
      if (!regions.has(region)) regions.set(region, { title: titleOf(region), items: [] });
      regions.get(region).items.push(item);
    }
    return {
      scope: used,
      note: used === "window" ? "Reading the open window / dialog only." : "Reading the whole visible page.",
      regions: Array.from(regions.values()).filter((r) => r.items.length),
      buttons, count,
      items: Array.from(regions.values()).flatMap((r) => r.items)
    };
  }

  // The boxes that are in `after` but were not in `before` (what a button revealed).
  function appeared(before, after) {
    const known = new Set(before.items.map((i) => i.element));
    return after.items.filter((i) => !known.has(i.element));
  }

  // A plain-text account, for the developer: nothing typed on the page, no values.
  function asText(result, heading = "Analyze page") {
    const lines = [`${heading} — ${result.note} ${result.count} control(s).`, ""];
    for (const region of result.regions) {
      lines.push(`[${region.title}]`);
      for (const i of region.items) {
        const extra = [i.required ? "required" : "", i.disabled ? "disabled" : "", i.options ? `choices: ${i.options.slice(0, 12).map((o) => o.label).join(", ")}${i.options.length > 12 ? ", …" : ""}` : "", i.reason || ""].filter(Boolean).join("; ");
        lines.push(`  ${i.kind.padEnd(8)} ${i.label || "(no label)"}  ${i.selectors[0] || (i.needsLabel ? "(found by its label)" : "")}${extra ? `  — ${extra}` : ""}`);
      }
    }
    return lines.join("\n");
  }

  // A report-free copy of a scan that can cross to the page / be stored (no DOM nodes).
  const plain = (result) => ({ ...result, regions: result.regions.map((r) => ({ title: r.title, items: r.items.map(({ element, ...rest }) => rest) })), buttons: result.buttons.map(({ element, ...rest }) => rest), items: result.items.map(({ element, ...rest }) => rest) });

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.pageAnalysis = { scan, appeared, asText, plain, suggestKey, suggestField, targetsList, topLayer };
})();
