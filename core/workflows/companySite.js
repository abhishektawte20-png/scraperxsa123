"use strict";

/*
 * Company > Site. Adds ONE site with every value of the report in one form: opens the Site section, presses
 * "Add New Site", fills the form, presses SAVE once and reads the site back from the section.
 *
 *   - Site type is always "Primary HQ" and status always "Current" (the team's rule); the site name is the city.
 *   - A site that is already listed (same address line, or the same city when the report has no address) is
 *     not added again: it is reported as "Already in RTS", unless the researcher asks to add it anyway.
 *   - Nothing is reported saved unless RTS closed the form and lists the site afterwards.
 *   - If the form ends up with an error, it is cancelled so a half-filled form is never left behind.
 */
(() => {
  const TIMEOUTS = { open: 4000, field: 1500, settle: 8000, list: 3000, poll: 40, section: 1500, state: 9000, after: 900 };
  const DEFAULTS = { siteType: "Primary HQ", status: "Current" };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(check, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return true;
      await wait(TIMEOUTS.poll);
    }
    return Boolean(check());
  }

  const sb = () => globalThis.SXRTS.selectorBuilder;
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const key = (text) => squash(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function isShown(node) {
    if (typeof node.checkVisibility === "function") return node.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.style?.display === "none" || current.style?.visibility === "hidden") return false;
    }
    return true;
  }
  const labelOf = (node) => squash(node.value || node.textContent);

  // ---- where each box is (names RTS uses, then the text printed next to it) ----
  const SPEC = {
    siteName: ['input[name="site.siteName"]', "sx-after::input::Site name*"],
    siteType: ['select[name="site.siteType.id"]', "sx-after::select::Site Type*"],
    address1: ['input[name="site.address1"]', "sx-after::input::Address Line 1"],
    address2: ['input[name="site.address2"]', "sx-after::input::Address Line 2"],
    city: ['input[name="site.city"]', "sx-after::input::City*"],
    country: ['select[name="site.countryCode.id"]', "sx-after::select::Country*"],
    stateSelect: ['select[name="site.state.id"]', 'select[name="site.stateCode.id"]', "sx-after::select::State*"],
    province: ['input[name="site.province"]', "#provinceInput", "sx-after::input::Province", "sx-after::input::State*"],
    zip: ['input[name="site.zip"]', "sx-after::input::Zip (Format)", "sx-after::input::Zip"],
    phone: ['input[name="site.phone"]', "sx-after::input::Phone (Format)", "sx-after::input::Phone"],
    fax: ['input[name="site.fax"]', "sx-after::input::Fax (Format)", "sx-after::input::Fax"],
    email: ['input[name="site.coEmailAddr"]', "sx-after::input::Email"],
    status: ['select[name="site.siteStatus.id"]', "sx-after::select::Status*"]
  };
  const SAVE = { selectors: ["#saveSiteInfoButton"], text: "save" };

  // What this researcher pointed at in "Set up Site" wins over the built-in guesses above:
  // { bar?, openButton?, save?, cancel?, roles?: { siteName: { selectors }, ... } }.
  const SETUP_KEY = "sxrts_site_setup";
  let setup = null;
  const taught = () => setup || globalThis.SXRTS.teamDefaults?.siteSetup || null;

  // The open form: the nearest block around SAVE that holds the form's boxes (null while the form is closed).
  const FIELD_BOXES = "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=image]), select, textarea";
  function formRoot() {
    const save = findSave();
    if (!save) return null;
    for (let node = save.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelectorAll(FIELD_BOXES).length >= 5) return node;
    }
    return null;
  }

  // The words printed beside each box, whatever RTS calls the box itself.
  const LABELS = {
    siteName: /^site name\b/, siteType: /^site type\b/, address1: /^address line 1\b/, address2: /^address line 2\b/, city: /^city\b/, country: /^country\b/,
    zip: /^(zip|postal)\b/, phone: /^(phone|telephone)\b/, fax: /^fax\b/, email: /^e ?mail\b/, status: /^status\b/, state: /^(state|province|region)\b/
  };
  const WANTS = { siteType: "select", country: "select", status: "select", stateSelect: "select", province: "input" };
  function byLabel(name) {
    const root = formRoot();
    if (!root) return null;
    const pattern = LABELS[name === "stateSelect" || name === "province" ? "state" : name];
    if (!pattern) return null;
    const controls = Array.from(root.querySelectorAll(FIELD_BOXES)).filter(isShown);
    const labels = Array.from(root.querySelectorAll("td, th, label, span, div, b, strong, p")).filter((n) => {
      if (!isShown(n) || n.querySelector("input, select, textarea")) return false;
      const t = key(n.textContent);
      return t && t.length <= 30 && pattern.test(t);
    });
    for (const label of labels) {
      const control = controls.find((c) => !label.contains(c) && (label.compareDocumentPosition(c) & 4));
      if (!control) continue;
      const tag = control.tagName.toLowerCase();
      const want = WANTS[name];
      if (want ? tag !== want : /^(siteName|address1|address2|city|zip|phone|fax|email)$/.test(name) && tag === "select") continue;
      return control;
    }
    return null;
  }

  // A box the researcher pointed at is the only one used for that role (a look-alike is never guessed instead).
  // Otherwise: RTS's own names, then the words printed beside the box.
  function find(name) {
    const pointed = taught()?.roles?.[name]?.selectors;
    for (const selector of pointed?.length ? pointed : SPEC[name]) {
      const hit = sb().matchAll(selector).find(isShown);
      if (hit) return hit;
    }
    return pointed?.length ? null : byLabel(name);
  }

  // The state box, however RTS draws it: a dropdown holding the state (found by its label, its name, or by the choice
  // it offers) or a plain box (by label or name). Returns { node, kind } or null.
  function findState(wanted) {
    const named = find("stateSelect");
    if (named && (!wanted || optionFor(named, wanted))) return { node: named, kind: "select" };
    const root = formRoot();
    if (root && wanted) {
      const taken = new Set(["siteType", "country", "status"].map(find).filter(Boolean));
      const holder = Array.from(root.querySelectorAll("select")).filter((n) => isShown(n) && !taken.has(n)).find((n) => optionFor(n, wanted));
      if (holder) return { node: holder, kind: "select" };
    }
    if (named) return { node: named, kind: "select" };
    const box = find("province") || (root && Array.from(root.querySelectorAll("input")).filter(isShown).find((n) => /province|state|region/i.test(`${n.name} ${n.id}`)));
    return box ? { node: box, kind: "input" } : null;
  }

  // What the form shows, for a message that says what was not found.
  function seenBoxes() {
    const root = formRoot();
    if (!root) return "";
    const labels = Array.from(root.querySelectorAll(FIELD_BOXES)).filter(isShown).map((c) => {
      const cell = c.closest("td, div, label");
      const before = c.closest("td")?.previousElementSibling || cell?.previousElementSibling;
      return squash(before?.textContent) || c.name || c.id || c.tagName.toLowerCase();
    });
    return labels.slice(0, 14).join(", ");
  }

  const BUTTONS = 'input[type=button], input[type=submit], button, [role=button]';
  function findButton(selectors, text) {
    for (const selector of selectors) {
      const hit = sb().matchAll(selector).find(isShown);
      if (hit) return hit;
    }
    return Array.from(document.querySelectorAll(BUTTONS)).find((node) => isShown(node) && key(labelOf(node)) === text) || null;
  }
  const findOpener = () => findButton([...(taught()?.openButton?.selectors ?? []), '[sid="addNewSite"]'], key(taught()?.openButton?.text) || "add new site");
  const findSave = () => findButton([...(taught()?.save?.selectors ?? []), ...SAVE.selectors], key(taught()?.save?.text) || SAVE.text);
  const findCancel = () => findButton([...(taught()?.cancel?.selectors ?? [])], key(taught()?.cancel?.text) || "cancel");
  const formOpen = () => Boolean(find("siteName"));

  // ---- values ----
  const COUNTRY_ALIASES = {
    usa: "United States", us: "United States", "u s": "United States", "u s a": "United States", "united states of america": "United States", america: "United States",
    uk: "United Kingdom", "u k": "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom",
    uae: "United Arab Emirates", "south korea": "South Korea", korea: "South Korea", "republic of korea": "South Korea", "czechia": "Czech Republic", "russian federation": "Russia", "viet nam": "Vietnam", "turkiye": "Turkey"
  };
  const REGIONS = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
    AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario",
    PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon"
  };

  // The option of a dropdown that says `wanted` (by its text, its value, a known alias or a state abbreviation).
  function optionFor(select, wanted, aliases = {}) {
    const text = squash(wanted);
    const candidates = [text, aliases[key(text)], REGIONS[text.toUpperCase()]].filter(Boolean);
    for (const candidate of candidates) {
      const hit = Array.from(select.options).find((o) => key(o.textContent) === key(candidate) || key(o.value) === key(candidate));
      if (hit) return hit;
    }
    return null;
  }

  async function setSelect(name, select, wanted, aliases) {
    const option = optionFor(select, wanted, aliases);
    if (!option) throw new Error(`${name}: "${wanted}" is not one of the dropdown's choices in RTS.`);
    await globalThis.SXRTS.adapters.nativeSelect.selectNativeOption(select, option.textContent.trim());
    if (select.selectedOptions[0] !== option) throw new Error(`${name}: RTS did not keep "${wanted}" in the dropdown.`);
  }

  async function setText(name, control, value) {
    const adapter = globalThis.SXRTS.adapters.textField;
    await adapter.applyText(control, value);
    if (!adapter.verifyText(control, value)) throw new Error(`${name}: the box did not keep "${value}".`);
  }

  // ---- the section ----
  // A click that reaches whatever the page listens to: the whole press, sent to the element itself, so it bubbles up
  // to the bar's own handler and to a handler on the icon or the title alike.
  function press(node) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  }

  // Things that open the Site section, most likely first: the little icon / title inside the section's own title
  // bar, then the bar, then any shown element whose text is "Site". The innermost element comes first because a click
  // reaches its parents but never its children.
  function siteBars() {
    const out = [];
    const add = (node) => { if (node && isShown(node) && !out.includes(node)) out.push(node); };
    for (const selector of taught()?.bar?.selectors ?? []) for (const node of sb().matchAll(selector)) add(node);
    const titleOf = (node) => key(node.textContent) === "site" || key(node.textContent) === "sites";
    const block = document.getElementById("blockSite");
    const head = block?.firstElementChild;
    if (head && isShown(head)) {
      for (const node of Array.from(head.querySelectorAll("*"))) if (!node.children.length && titleOf(node)) add(node);
      for (const node of Array.from(head.querySelectorAll('[class*="icon" i], [class*="expand" i], [class*="toggle" i], [class*="collapse" i], [class*="arrow" i], [class*="plus" i], [id*="icon" i], [id*="expand" i]'))) add(node);
      for (const node of Array.from(head.querySelectorAll("*"))) if (!node.children.length && /^[+\u2795\u25b6\u25b8\u25ba\u25bc]$/.test(squash(node.textContent))) add(node);
      add(head);
    }
    const walker = document.createTreeWalker(document.body, 4);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!/^(site|sites)$/i.test(squash(text.nodeValue))) continue;
      let node = text.parentElement;
      for (let depth = 0; node && depth < 3 && key(node.textContent).length <= 12; depth++, node = node.parentElement) add(node);
    }
    return out;
  }

  const sectionOpen = () => Boolean(findOpener()) || formOpen();

  // Opens the Site section: the page as it is, then the Company tab, then the other tab.
  async function reveal() {
    const nav = globalThis.SXRTS.navigation;
    if (sectionOpen()) return findOpener();
    for (const tab of [null, "Company", "Business Entity"]) {
      if (tab) await nav?.navigateToSection?.(tab);
      if (sectionOpen()) return findOpener();
      for (const bar of siteBars().slice(0, 12)) {
        press(bar);
        if (await waitFor(sectionOpen, TIMEOUTS.section)) return findOpener();
      }
    }
    return null;
  }

  const sectionRoot = (opener) => document.getElementById("blockSite") || opener?.closest("[id^=block]") || opener?.parentElement?.parentElement || document.body;

  // What the Site section shows besides the form being typed in.
  function listedText(root) {
    const clone = root.cloneNode(true);
    for (const form of clone.querySelectorAll("form, input, select, textarea, button")) form.remove();
    return key(clone.textContent);
  }

  const alreadyListed = (root, record) => {
    const text = listedText(root);
    if (record.address1) {
      if (text.includes(key(record.address1))) return true;
      // The list may show only the street ("12600 Crystal View Blvd.") while the report gives the whole address.
      const street = key(record.address1.split(",")[0]);
      return street.length >= 6 && text.includes(street) && (!record.city || text.includes(key(record.city)));
    }
    return Boolean(record.city) && text.includes(key(record.city));
  };

  function formErrors() {
    const found = Array.from(document.querySelectorAll('[class*="error" i], [class*="invalid" i], .errorMsg, [role=alert]')).filter(isShown).map((n) => squash(n.textContent)).filter((t) => t && t.length < 200);
    return Array.from(new Set(found)).slice(0, 3).join(" ");
  }

  // Empties what was typed and chosen, so values of a cancelled try (or a failed run) can never end up in the next site.
  async function clearForm() {
    const adapters = globalThis.SXRTS.adapters;
    for (const name of ["siteName", "address1", "address2", "city", "province", "zip", "phone", "fax", "email"]) {
      const box = find(name);
      if (box && box.value) { try { await adapters.textField.applyText(box, ""); } catch { /* best effort */ } }
    }
    for (const name of ["siteType", "stateSelect", "country", "status"]) {
      const select = find(name);
      const blank = select && Array.from(select.options).find((o) => o.value === "" || !squash(o.textContent));
      if (blank && select.selectedOptions[0] !== blank) { try { await adapters.nativeSelect.selectNativeOption(select, blank.textContent.trim()); } catch { /* best effort */ } }
    }
  }

  async function cancelForm() {
    await clearForm();
    const cancel = findCancel();
    if (cancel) { cancel.click(); await wait(200); }
  }

  // ---- the built-in Site can be switched off ("Unmap") and back on ----
  const FLAG_KEY = "sxrts_site_off";
  let off = false;
  const isEnabled = () => !off;
  async function loadFlag() {
    try {
      off = Boolean((await chrome.storage.local.get(FLAG_KEY))?.[FLAG_KEY]);
      const taughtStored = (await chrome.storage.local.get(SETUP_KEY))?.[SETUP_KEY];
      setup = taughtStored && typeof taughtStored === "object" ? taughtStored : null;
    } catch { off = false; }
    return !off;
  }
  const getSetup = () => taught();
  async function setSetup(next) {
    setup = next && Object.keys(next).length ? next : null;
    try { if (setup) await chrome.storage.local.set({ [SETUP_KEY]: setup }); else await chrome.storage.local.remove(SETUP_KEY); } catch { /* the choice still holds for this page */ }
  }
  async function setEnabled(on) {
    off = !on;
    try { if (off) await chrome.storage.local.set({ [FLAG_KEY]: true }); else await chrome.storage.local.remove(FLAG_KEY); } catch { /* the choice still holds for this page */ }
  }

  // ---- sites this extension added (so a site the Site list cannot confirm is never added twice) ----
  const ADDED_KEY = "sxrts_sites_added";
  const ADDED_DAYS = 30;
  function profileKey() {
    let pbId = "";
    try { pbId = globalThis.SXRTS.identityLock?.readRtsIdentityFromPage?.().pbId || ""; } catch { /* not on a profile */ }
    return pbId || String(window.location?.pathname || "");
  }
  const siteKey = (r) => key(r.address1 ? r.address1.split(",")[0] : r.city) + "|" + key(r.city);
  async function addedBefore(r) {
    try {
      const all = (await chrome.storage.local.get(ADDED_KEY))?.[ADDED_KEY] || {};
      return (all[profileKey()] || []).some((e) => e.k === siteKey(r) && Date.now() - e.at < ADDED_DAYS * 86400000);
    } catch { return false; }
  }
  async function rememberAdded(r) {
    try {
      const all = (await chrome.storage.local.get(ADDED_KEY))?.[ADDED_KEY] || {};
      const mine = (all[profileKey()] || []).filter((e) => Date.now() - e.at < ADDED_DAYS * 86400000);
      all[profileKey()] = [...mine, { k: siteKey(r), at: Date.now() }];
      await chrome.storage.local.set({ [ADDED_KEY]: all });
    } catch { /* the site list is still the main check */ }
  }

  // ---- city, state, country and zip taken from a full address, only to fill what the report left out ----
  const countryNames = () => (globalThis.SXRTS.registry?.getField?.("company.sites")?.form?.country?.options ?? []).map((o) => o.label);
  const countryOf = (part) => COUNTRY_ALIASES[key(part)] || countryNames().find((c) => key(c) === key(part)) || "";
  const POSTCODE = /\b(\d{4,6}(?:-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)\b/;
  function deriveFromAddress(full) {
    const parts = squash(full).split(",").map(squash).filter(Boolean);
    const out = {};
    if (parts.length < 2) return out;
    const country = countryOf(parts[parts.length - 1]);
    if (country) { out.country = country; parts.pop(); }
    // The last part usually holds the state and the postcode ("TX 77568", "400066 Mumbai MH").
    const tail = parts[parts.length - 1] || "";
    const code = POSTCODE.exec(tail);
    let rest = tail;
    if (code) { out.zip = code[1]; rest = squash(tail.replace(code[1], " ")); }
    const regionWords = Object.values(REGIONS).map(key);
    const lastWord = rest.split(" ").pop();
    if (/^[A-Z]{2}$/.test(lastWord) && rest.split(" ").length >= 1) {
      out.state = lastWord;
      const before = squash(rest.slice(0, rest.length - lastWord.length));
      out.city = before || (parts.length > 1 ? parts[parts.length - 2] : "");
    } else if (regionWords.includes(key(rest))) {
      out.state = rest;
      out.city = parts.length > 1 ? parts[parts.length - 2] : "";
    } else if (rest) {
      out.city = rest;
    }
    if (!out.city && parts.length > 1) out.city = parts[parts.length - 2];
    return out;
  }

  /*
   * record: { city, country, state, address1, address2, zip, phone, fax, email, siteName? }
   * options: { addAnyway }
   */
  async function runSite(record, options, trace) {
    const did = (text) => trace.push(text);
    const r = {};
    for (const k of ["siteName", "address1", "address2", "city", "country", "state", "zip", "phone", "fax", "email"]) r[k] = squash(record[k]);
    // The report may give only a full address: take what is missing from it.
    const derived = {};
    if (r.address1 && (!r.city || !r.country || !r.state || !r.zip)) {
      const d = deriveFromAddress(r.address1);
      for (const k of ["city", "country", "state", "zip"]) if (!r[k] && d[k]) { r[k] = d[k]; derived[k] = d[k]; }
    }
    r.siteName = r.siteName || r.city;

    if (!r.city || !r.country) return { status: "failed", reason: `Site: RTS needs a ${[!r.city && "city", !r.country && "country"].filter(Boolean).join(" and ")} to add a site, and the report has none.` };

    const opener = await reveal();
    if (opener || formOpen()) did("Site section open");
    if (!formOpen()) {
      if (!opener) throw new Error("The Site section could not be opened by the extension: the Add New Site button did not appear. Open the Site section by hand (click its bar), then publish again.");
      if (opener.disabled || opener.getAttribute("aria-disabled") === "true") throw new Error("The Add New Site button is disabled right now.");
      if (!options.addAnyway && !options.dryRun && alreadyListed(sectionRoot(opener), r)) {
        return { status: "skipped", reason: `Site already exists in RTS (${r.address1 || r.city}). Nothing was added. Tick "Add the site even if one exists" to add it anyway.` };
      }
      if (!options.addAnyway && !options.dryRun && await addedBefore(r)) {
        return { status: "skipped", reason: `Site already exists in RTS: the extension added ${r.address1 || r.city} to this profile earlier, although the Site list could not show it. Nothing was added. Tick "Add the site even if one exists" to add it anyway.` };
      }
      opener.click();
      if (!(await waitFor(formOpen, TIMEOUTS.open))) throw new Error('The site form did not open after clicking "Add New Site".');
    }
    did("Add New Site pressed, form open");

    let stateNote = "";
    try {
      await setText("Site name", find("siteName"), r.siteName);
      const type = find("siteType");
      if (!type) throw new Error("Site type: the dropdown was not found in the form.");
      await setSelect("Site type", type, DEFAULTS.siteType);
      did("site name, site type");
      if (r.address1) { const box = find("address1"); if (!box) throw new Error("Address line 1: the box was not found."); await setText("Address line 1", box, r.address1); }
      if (r.address2) { const box = find("address2"); if (box) await setText("Address line 2", box, r.address2); }
      const country = find("country");
      if (!country) throw new Error("Country: the dropdown was not found in the form.");
      await setSelect("Country", country, r.country, COUNTRY_ALIASES);
      did("address, country");
      // The state box can change when the country does (a list for the US, a text box elsewhere).
      if (r.state) {
        // RTS may load the state list a moment after the country is chosen: wait for it.
        await waitFor(() => { const f = findState(r.state); return Boolean(f && (f.kind === "input" || optionFor(f.node, r.state))); }, TIMEOUTS.state);
        const found = findState(r.state);
        if (found?.kind === "select") await setSelect("State", found.node, r.state);
        else if (found) await setText("State", found.node, r.state);
        else {
          // Not every country asks for a state: carry on, and say so if Save then refuses.
          stateNote = `the State box was not found in the form (boxes on screen: ${seenBoxes() || "none"})`;
          did("state box not found, skipped");
        }
      }
      if (!stateNote) did("state");
      const city = find("city");
      if (!city) throw new Error("City: the box was not found in the form.");
      await setText("City", city, r.city);
      for (const [name, label, value] of [["zip", "Zip", r.zip], ["phone", "Phone", r.phone], ["fax", "Fax", r.fax], ["email", "Email", r.email]]) {
        if (!value) { const stale = find(name); if (stale && stale.value) await globalThis.SXRTS.adapters.textField.applyText(stale, ""); continue; }
        const box = find(name);
        if (!box) throw new Error(`${label}: the box was not found in the form.`);
        await setText(label, box, value);
      }
      const status = find("status");
      if (!status) throw new Error("Status: the dropdown was not found in the form.");
      await setSelect("Status", status, DEFAULTS.status);
      did("city, zip, phone, email, status");
      // A page that redraws the form when a choice changes can wipe boxes filled earlier: read them back, fill again once.
      const wanted = [["siteName", "Site name", r.siteName], ["address1", "Address line 1", r.address1], ["address2", "Address line 2", r.address2], ["city", "City", r.city], ["zip", "Zip", r.zip], ["phone", "Phone", r.phone], ["fax", "Fax", r.fax], ["email", "Email", r.email]];
      for (const [name, label, value] of wanted) {
        if (!value) continue;
        const box = find(name);
        if (box && squash(box.value) !== value) await setText(label, box, value);
      }
      for (const [name, label, value] of [["siteType", "Site type", DEFAULTS.siteType], ["country", "Country", r.country], ["status", "Status", DEFAULTS.status]]) {
        const select = find(name);
        const option = select && optionFor(select, value, name === "country" ? COUNTRY_ALIASES : {});
        if (select && option && select.selectedOptions[0] !== option) await setSelect(label, select, value, name === "country" ? COUNTRY_ALIASES : {});
      }
    } catch (error) {
      await cancelForm();
      throw error;
    }

    did("every box read back");
    if (options.dryRun) { await cancelForm(); return { status: "checked", trace }; }
    const save = findSave();
    if (!save) { await cancelForm(); throw new Error("The site form's SAVE button was not found."); }
    if (!(await waitFor(() => !save.disabled && save.getAttribute("aria-disabled") !== "true", TIMEOUTS.field))) {
      const why = formErrors();
      await cancelForm();
      throw new Error(`The site form's SAVE button stayed disabled, so RTS did not accept the values.${stateNote ? ` Likely cause: ${stateNote}.` : ""}${why ? ` RTS says: ${why}` : ""}`);
    }
    save.click();
    did("SAVE pressed once");
    // RTS may close the form, or leave it open with Save back to greyed out (like its other Save buttons).
    const settled = await waitFor(() => !formOpen() || save.disabled || !save.isConnected || !isShown(save), TIMEOUTS.settle);
    if (settled && formOpen()) {
      // Greyed-out Save with the form still open: RTS is either busy saving or has refused. Give it a moment, then read
      // what it says: a refusal is reported with RTS's own words, never as a saved site.
      await wait(TIMEOUTS.after);
      const refusal = formErrors();
      await cancelForm();
      if (refusal) throw new Error(`RTS did not accept the site. RTS says: ${refusal}`);
    }
    if (!settled) {
      const why = formErrors();
      await cancelForm();
      throw new Error(`Save did not complete: the site form is still open.${why ? ` RTS says: ${why}` : " A required box may be empty or invalid."}`);
    }

    await rememberAdded(r);
    const root = sectionRoot(findOpener() || opener);
    const shown = await waitFor(() => alreadyListed(root, { address1: r.address1, city: r.city, siteName: r.siteName }), TIMEOUTS.list);
    const note = Object.keys(derived).length ? ` (${Object.entries(derived).map(([k, v]) => `${k} ${v}`).join(", ")} taken from the address)` : "";
    if (shown) return { status: "savedValueVerified", name: r.siteName, ...(note ? { derived: note } : {}) };
    const seen = listedText(root).replace(/\s+/g, " ").slice(0, 140);
    return {
      status: "savedStateVerified", name: r.siteName,
      note: `Saved ${r.siteName}, but the Site list does not show it yet. Check the Site list in RTS.`,
      detail: `Saved, but "${r.address1 || r.city}" is not in the Site list on the page, so it could not be read back. The list shows: "${seen || "(nothing)"}". Check the Site list in RTS.`
    };
  }

  // Adds the steps that were done to any failure, so a message says exactly where it stopped.
  async function applySite(record, options = {}) {
    const trace = [];
    try {
      const result = await runSite(record, options, trace);
      return { ...result, trace };
    } catch (error) {
      if (!error.traced) { if (trace.length) error.message += ` (Done before this: ${trace.join("; ")}.)`; error.traced = true; }
      error.trace = trace;
      throw error;
    }
  }

  // "Set up Site": what the extension finds on the page right now. It opens the Site section and the form (and leaves
  // the form open so a missing box can be pointed at). Nothing is typed or saved.
  async function inspect() {
    const items = [];
    const add = (id, label, ok, selector = "", note = "") => items.push({ id, label, ok, selector, note });
    const hitSelector = (node) => { try { return sb().inspectButton(node, {}).selectors?.[0] || ""; } catch { return ""; } };
    const opener = await reveal();
    add("section", "Site section opens", Boolean(opener || formOpen()), "", opener || formOpen() ? "" : "The Add New Site button did not appear. Point at the Site bar, or open the section by hand.");
    add("opener", "Add New Site button", Boolean(opener || formOpen()), opener ? hitSelector(opener) : "");
    if (!formOpen() && opener && !opener.disabled) { opener.click(); await waitFor(formOpen, TIMEOUTS.open); }
    add("form", "The form opens", formOpen());
    const boxes = [["siteName", "Site name"], ["siteType", "Site type"], ["address1", "Address line 1"], ["city", "City"], ["country", "Country"], ["zip", "Zip"], ["phone", "Phone"], ["fax", "Fax"], ["email", "Email"], ["status", "Status"]];
    for (const [id, label] of boxes) { const node = find(id); add(id, label, Boolean(node), node ? hitSelector(node) : ""); }
    const stateNode = findState("")?.node;
    add("state", "State (a list for the US, a box elsewhere)", Boolean(stateNode), stateNode ? hitSelector(stateNode) : "", stateNode ? "" : "Neither the list nor the box for the state is on screen (it can depend on the country).");
    const type = find("siteType");
    add("typeChoice", 'Site type offers "Primary HQ"', Boolean(type && optionFor(type, DEFAULTS.siteType)));
    const status = find("status");
    add("statusChoice", 'Status offers "Current"', Boolean(status && optionFor(status, DEFAULTS.status)));
    const save = findSave();
    add("save", "SAVE button", Boolean(save), save ? hitSelector(save) : "");
    const cancel = findCancel();
    add("cancel", "Cancel button", Boolean(cancel), cancel ? hitSelector(cancel) : "", cancel ? "" : "Optional: used to put the form away after an error.");
    return { items };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.companySite = { applySite, inspect, reveal, cancelForm, TIMEOUTS, DEFAULTS, optionFor, alreadyListed, deriveFromAddress, isEnabled, setEnabled, loadFlag, getSetup, setSetup };
})();
