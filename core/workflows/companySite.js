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
  const TIMEOUTS = { open: 4000, field: 1500, settle: 8000, list: 3000, poll: 40, section: 1500 };
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

  function find(name) {
    for (const selector of SPEC[name]) {
      const hit = sb().matchAll(selector).find(isShown);
      if (hit) return hit;
    }
    return null;
  }

  const BUTTONS = 'input[type=button], input[type=submit], button, [role=button]';
  function findButton(selectors, text) {
    for (const selector of selectors) {
      const hit = sb().matchAll(selector).find(isShown);
      if (hit) return hit;
    }
    return Array.from(document.querySelectorAll(BUTTONS)).find((node) => isShown(node) && key(labelOf(node)) === text) || null;
  }
  const findOpener = () => findButton(['[sid="addNewSite"]'], "add new site");
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
  // Opens the Site section (and the Company tab) until the "Add New Site" button is on screen.
  async function reveal() {
    const nav = globalThis.SXRTS.navigation;
    let opener = findOpener();
    if (opener || formOpen()) return opener;
    await nav?.ensureSectionOpen?.(() => Boolean(findOpener()) || formOpen(), ["Site", "Sites"]);
    opener = findOpener();
    if (opener || formOpen()) return opener;
    await nav?.navigateToSection?.("Company");
    await nav?.ensureSectionOpen?.(() => Boolean(findOpener()) || formOpen(), ["Site", "Sites"]);
    return findOpener();
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
    if (record.address1) return text.includes(key(record.address1));
    return Boolean(record.city) && text.includes(key(record.city));
  };

  function formErrors() {
    const found = Array.from(document.querySelectorAll('[class*="error" i], [class*="invalid" i], .errorMsg, [role=alert]')).filter(isShown).map((n) => squash(n.textContent)).filter((t) => t && t.length < 200);
    return Array.from(new Set(found)).slice(0, 3).join(" ");
  }

  async function cancelForm() {
    const cancel = findButton([], "cancel");
    if (cancel) { cancel.click(); await wait(200); }
  }

  /*
   * record: { city, country, state, address1, address2, zip, phone, fax, email, siteName? }
   * options: { addAnyway }
   */
  async function applySite(record, options = {}) {
    const r = {};
    for (const k of ["siteName", "address1", "address2", "city", "country", "state", "zip", "phone", "fax", "email"]) r[k] = squash(record[k]);
    r.siteName = r.siteName || r.city;

    if (!r.city || !r.country) return { status: "failed", reason: `Site: RTS needs a ${[!r.city && "city", !r.country && "country"].filter(Boolean).join(" and ")} to add a site, and the report has none.` };

    const opener = await reveal();
    if (!formOpen()) {
      if (!opener) throw new Error("The Add New Site button was not found. Open the Company tab and its Site section, then publish again.");
      if (opener.disabled || opener.getAttribute("aria-disabled") === "true") throw new Error("The Add New Site button is disabled right now.");
      if (!options.addAnyway && alreadyListed(sectionRoot(opener), r)) {
        return { status: "skipped", reason: `Site already exists in RTS (${r.address1 || r.city}). Nothing was added. Tick "Add the site even if one exists" to add it anyway.` };
      }
      opener.click();
      if (!(await waitFor(formOpen, TIMEOUTS.open))) throw new Error('The site form did not open after clicking "Add New Site".');
    }

    try {
      await setText("Site name", find("siteName"), r.siteName);
      const type = find("siteType");
      if (!type) throw new Error("Site type: the dropdown was not found in the form.");
      await setSelect("Site type", type, DEFAULTS.siteType);
      if (r.address1) { const box = find("address1"); if (!box) throw new Error("Address line 1: the box was not found."); await setText("Address line 1", box, r.address1); }
      if (r.address2) { const box = find("address2"); if (box) await setText("Address line 2", box, r.address2); }
      const country = find("country");
      if (!country) throw new Error("Country: the dropdown was not found in the form.");
      await setSelect("Country", country, r.country, COUNTRY_ALIASES);
      // The state box can change when the country does (a list for the US, a text box elsewhere).
      if (r.state) {
        await waitFor(() => Boolean(find("stateSelect") || find("province")), TIMEOUTS.field);
        const list = find("stateSelect");
        if (list) await setSelect("State", list, r.state);
        else {
          const box = find("province");
          if (!box) throw new Error("State: neither a dropdown nor a box was found in the form.");
          await setText("State", box, r.state);
        }
      }
      const city = find("city");
      if (!city) throw new Error("City: the box was not found in the form.");
      await setText("City", city, r.city);
      for (const [name, label, value] of [["zip", "Zip", r.zip], ["phone", "Phone", r.phone], ["fax", "Fax", r.fax], ["email", "Email", r.email]]) {
        if (!value) continue;
        const box = find(name);
        if (!box) throw new Error(`${label}: the box was not found in the form.`);
        await setText(label, box, value);
      }
      const status = find("status");
      if (!status) throw new Error("Status: the dropdown was not found in the form.");
      await setSelect("Status", status, DEFAULTS.status);
    } catch (error) {
      await cancelForm();
      throw error;
    }

    const save = findButton(SAVE.selectors, SAVE.text);
    if (!save) { await cancelForm(); throw new Error("The site form's SAVE button was not found."); }
    if (!(await waitFor(() => !save.disabled && save.getAttribute("aria-disabled") !== "true", TIMEOUTS.field))) {
      const why = formErrors();
      await cancelForm();
      throw new Error(`The site form's SAVE button stayed disabled, so RTS did not accept the values.${why ? ` RTS says: ${why}` : ""}`);
    }
    save.click();
    const settled = await waitFor(() => !formOpen(), TIMEOUTS.settle);
    if (!settled) {
      const why = formErrors();
      await cancelForm();
      throw new Error(`Save did not complete: the site form is still open.${why ? ` RTS says: ${why}` : " A required box may be empty or invalid."}`);
    }

    const root = sectionRoot(findOpener() || opener);
    const shown = await waitFor(() => alreadyListed(root, { address1: r.address1, city: r.city, siteName: r.siteName }), TIMEOUTS.list);
    if (shown) return { status: "savedValueVerified", name: r.siteName };
    return { status: "savedStateVerified", name: r.siteName, detail: `Saved. The Site section does not list "${r.address1 || r.city}" on the page, so it could not be read back; check the Site list in RTS.` };
  }

  // Read-only ("Check mappings"): the Site form is opened, every box is looked for, and the form is cancelled.
  async function check() {
    const parts = [];
    const add = (name, ok, note = "") => parts.push({ name, ok, note });
    const opener = await reveal();
    if (!opener && !formOpen()) return { notOnScreen: true, parts: [{ name: "Add New Site button", ok: false, note: "not on this page" }] };
    add("Add New Site button", true);
    let weOpened = false;
    if (!formOpen()) {
      opener.click();
      weOpened = true;
      if (!(await waitFor(formOpen, TIMEOUTS.open))) { add("Site form opens", false, "the form did not open"); return { parts }; }
    }
    for (const [name, label] of [["siteName", "Site name"], ["siteType", "Site type"], ["address1", "Address line 1"], ["city", "City"], ["country", "Country"], ["zip", "Zip"], ["phone", "Phone"], ["fax", "Fax"], ["email", "Email"], ["status", "Status"]]) add(label, Boolean(find(name)));
    add("State (list or box)", Boolean(find("stateSelect") || find("province")));
    const type = find("siteType");
    add('Site type offers "Primary HQ"', Boolean(type && optionFor(type, DEFAULTS.siteType)));
    const status = find("status");
    add('Status offers "Current"', Boolean(status && optionFor(status, DEFAULTS.status)));
    add("SAVE button", Boolean(findButton(SAVE.selectors, SAVE.text)));
    if (weOpened) await cancelForm();
    return { parts };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.workflows = globalThis.SXRTS.workflows || {};
  globalThis.SXRTS.workflows.companySite = { applySite, check, reveal, TIMEOUTS, DEFAULTS, optionFor, alreadyListed };
})();
