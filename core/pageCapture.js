"use strict";

/*
 * Automatic page capture. When a field cannot be written (no mapping yet, or a
 * control was not found), the report carries the structure of the part of the
 * RTS page where that field lives, so a mapping can be built from the report
 * alone. The page area is found by the field's own label on screen.
 *
 * Privacy: this is the structure only. Typed values and the value of every
 * input are never read, numbers in data-
 * attributes are masked, links keep their path but not their query, text is
 * kept only where it names a control or field (labels, headings, buttons,
 * options, "Name:") and is replaced by "…" everywhere else, and scripts,
 * styles and images are dropped.
 */
(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "TEMPLATE", "LINK", "META", "OBJECT", "EMBED"]);
  const KEEP = new Set(["id", "class", "name", "type", "role", "for", "placeholder", "title", "disabled", "checked", "selected", "readonly", "maxlength", "target", "colspan", "rowspan", "tabindex", "contenteditable"]);
  const VALUE_OK_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset"]);
  const MAX_TEXT = 80;
  const hostId = "sxrts-assistant-root";

  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const cut = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);

  function cleanAttributes(src, copy) {
    const tag = src.tagName.toLowerCase();
    const type = (src.getAttribute("type") || "").toLowerCase();
    for (const attr of Array.from(src.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (KEEP.has(name)) { copy.setAttribute(name, cut(value, 120)); continue; }
      if (name.startsWith("aria-")) { copy.setAttribute(name, cut(value, 60)); continue; }
      if (name.startsWith("data-")) { copy.setAttribute(name, /^\d{4,}$/.test(value) ? "#" : cut(value, 40)); continue; }
      if (name === "onclick" || name === "onchange") { copy.setAttribute(name, cut(squash(value), 80)); continue; }
      if (name === "href") {
        const path = value.startsWith("javascript:") ? "javascript:" : value.replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
        copy.setAttribute("href", cut(path, 80));
        continue;
      }
      if (name === "value" && (tag === "option" || tag === "button" || (tag === "input" && VALUE_OK_TYPES.has(type)))) { copy.setAttribute("value", cut(value, 40)); continue; }
      if (name === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(value)) copy.setAttribute("style", "display:none");
    }
  }

  // Text that names a control or a field (labels, headings, buttons, options, "Name:") is kept
  // so the area can be recognised; any other text may be the company's data and becomes "…".
  const LABEL_TAGS = new Set(["LABEL", "TH", "LEGEND", "BUTTON", "OPTION", "H1", "H2", "H3", "H4", "H5", "H6", "B", "STRONG", "SUMMARY", "A", "DT", "CAPTION"]);
  function keepText(text, parent) {
    if (!parent) return false;
    if (LABEL_TAGS.has(parent.tagName)) return true;
    if (/[:*]$/.test(text)) return true;
    return false;
  }

  function sanitizeNode(src, doc) {
    if (src.nodeType === 3) {
      const text = squash(src.nodeValue);
      if (!text) return null;
      return doc.createTextNode(keepText(text, src.parentElement) ? cut(text, MAX_TEXT) : "…");
    }
    if (src.nodeType !== 1 || SKIP.has(src.tagName)) return null;
    const tag = src.tagName.toLowerCase();
    const copy = doc.createElement(tag === "svg" || src.namespaceURI?.includes("svg") ? "svg" : tag);
    if (copy.tagName === "SVG") return copy;
    cleanAttributes(src, copy);
    if (tag === "input" || tag === "textarea" || tag === "img") return copy;
    for (const child of Array.from(src.childNodes)) {
      const kept = sanitizeNode(child, doc);
      if (kept) copy.appendChild(kept);
    }
    return copy;
  }

  // The structure of an element as readable text, one tag per line.
  function sanitize(el, { maxChars = 8000 } = {}) {
    const copy = sanitizeNode(el, el.ownerDocument);
    if (!copy) return "";
    const html = copy.outerHTML.replace(/></g, ">\n<");
    return html.length <= maxChars ? html : `${html.slice(0, maxChars)}\n<!-- cut here: ${html.length} characters in total -->`;
  }

  const norm = (text) => squash(text).toLowerCase().replace(/[:*]+$/, "").trim();

  // Words RTS uses on the page for each output field (besides the field's own label).
  const TERMS = {
    "businessEntity.nameVariations": ["Name Variations", "View All Name Variations"],
    "businessEntity.websiteAddresses": ["Website Address", "Website Addresses"],
    "businessEntity.emailDefaultStructure": ["Email Default Structure"],
    "company.sicCodes": ["SIC", "SIC Codes", "Industries and Verticals"],
    "company.keywords": ["Keywords"],
    "company.naicsCodes": ["NAICS", "Industries"],
    "businessEntity.socialMediaIdentifiers": ["Social Media Identifier", "SM Network"],
    "extras.verticals": ["Verticals", "Vertical"],
    "extras.management": ["Management"],
    "extras.industryCode": ["Industry Tagging", "Industries and Verticals"],
    "extras.employeeCount": ["Employees", "Employee"],
    "extras.address": ["Sites", "Site Name", "Address Line 1"],
    "extras.city": ["Sites", "City"],
    "extras.state": ["Sites", "Province", "State"],
    "extras.country": ["Sites", "Country"],
    "extras.postcode": ["Sites", "Zip"],
    "extras.phone": ["Sites", "Phone"],
    "extras.fax": ["Sites", "Fax"],
    "extras.siteEmail": ["Sites", "Email"]
  };

  function termsFor(path, label) {
    const base = String(path || "").replace(/\[\d+\]/g, "");
    const last = base.split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2");
    return Array.from(new Set([...(TERMS[base] || []), label, last].filter(Boolean)));
  }

  function hasLayout(doc) {
    return doc.documentElement.getClientRects().length > 0;
  }

  // The element holding a piece of text that equals one of the terms (exact, ignoring a trailing colon).
  function findLabel(doc, terms) {
    const wanted = terms.map(norm).filter(Boolean);
    const layout = hasLayout(doc);
    const walker = doc.createTreeWalker(doc.body, 4);
    const hits = new Map();
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || SKIP.has(el.tagName) || el.closest(`#${hostId}`)) continue;
      const text = norm(node.nodeValue);
      if (!text || text.length > MAX_TEXT) continue;
      const index = wanted.indexOf(text);
      if (index < 0) continue;
      if (layout && !el.getClientRects().length) continue;
      if (!hits.has(index)) hits.set(index, el);
    }
    const best = Math.min(...hits.keys());
    return hits.size ? { el: hits.get(best), term: terms[best] } : null;
  }

  // Climbs from the label to the area around it: up to the first level that holds a
  // control, then a little further, never past a size that would swamp the report.
  function areaAround(el, maxElements = 400) {
    let node = el;
    let sawControl = false;
    let extra = 0;
    while (node.parentElement && node.parentElement !== node.ownerDocument.body && node.parentElement !== node.ownerDocument.documentElement) {
      const parent = node.parentElement;
      if (parent.querySelectorAll("*").length > maxElements) break;
      node = parent;
      if (!sawControl) { if (node.querySelector("input, select, textarea, button, a[href], [onclick]")) sawControl = true; }
      else if (++extra >= 2) break;
    }
    return node;
  }

  /*
   * targets: [{ path, label, anchor? }]. `anchor` is an element already known to be
   * near the field (for example a mapped button); otherwise the field's label is
   * looked for on the page. Returns [{ path, label, found, term, html, note }].
   */
  function capture(doc, targets, { perCapture = 6000, total = 30000, maxTargets = 12 } = {}) {
    const results = [];
    const seen = new Map();
    let used = 0;
    for (const target of targets.slice(0, maxTargets)) {
      const base = { path: target.path, label: target.label || target.path };
      let area = null;
      let term = "";
      try {
        // A mapped button that is not on screen may be a look-alike hidden elsewhere (a pop-up's "No" button): ignore it.
        if (target.anchor?.isConnected && (!hasLayout(doc) || target.anchor.getClientRects().length > 0)) { area = areaAround(target.anchor); term = "(the mapped button)"; }
        else {
          const hit = findLabel(doc, termsFor(target.path, target.label));
          if (hit) { area = areaAround(hit.el); term = hit.term; }
        }
      } catch { area = null; }
      if (!area) { results.push({ ...base, found: false, term: "", html: "", note: "Not on screen. Open the section where this field is entered (the right tab or section) and send the report again." }); continue; }
      if (seen.has(area)) { results.push({ ...base, found: true, term, html: "", note: `Same page area as ${seen.get(area)}.` }); continue; }
      seen.set(area, base.path);
      const html = sanitize(area, { maxChars: Math.min(perCapture, Math.max(0, total - used)) });
      used += html.length;
      results.push({ ...base, found: true, term, html, note: html ? "" : "Capture limit reached." });
    }
    if (targets.length > maxTargets) results.push({ path: "(more)", label: "", found: false, term: "", html: "", note: `${targets.length - maxTargets} more field(s) not captured to keep the report small.` });
    return results;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.pageCapture = { capture, sanitize, findLabel, areaAround, termsFor };
})();
