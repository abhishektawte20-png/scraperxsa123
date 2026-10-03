"use strict";

/*
 * Catalog of agent-report fields that can be tied to an RTS form field by
 * "Map this field". Each entry says where the value lives in the internal
 * document, whether it is one value or a list, and which keys a list record
 * has. Fields the extension already writes natively (name variations,
 * website address, EDS, research notes, SIC) are not in this catalog.
 */
(() => {
  const FIELDS = [
    { path: "company.briefDescription", label: "Brief description", area: "Company", kind: "single", keys: [{ key: "value", label: "Description text" }],
      hint: "Open the Company tab where the brief (short) description is entered." },
    { path: "company.fullDescription", label: "Full description", area: "Company", kind: "single", keys: [{ key: "value", label: "Description text" }],
      hint: "Open the Company tab where the full description is entered." },
    { path: "company.keywords", label: "Keywords", area: "Company", kind: "list", keys: [{ key: "value", label: "Keyword" }],
      hint: "Open the Keywords area. Only plain text boxes with an Add button are supported; tag boxes that need Enter or suggestions are not." },
    { path: "company.naicsCodes", label: "NAICS codes", area: "Company", kind: "list", keys: [{ key: "code", label: "NAICS code" }],
      hint: "Open the NAICS section and have its Add button visible." },
    { path: "businessEntity.socialMediaIdentifiers", label: "Social media identifiers", area: "Business Entity", kind: "list",
      keys: [{ key: "network", label: "Network (Facebook, LinkedIn, ...)" }, { key: "handleOrUrl", label: "Handle or URL" }],
      rowKey: "network",
      hint: "Open the Social Media Identifiers section. If each network has its own \"New\" button that opens a separate window, choose \"Separate window\"; otherwise have its Add button visible." },
    { path: "extras.address", label: "Address", area: "Site", kind: "single", keys: [{ key: "value", label: "Full address" }], hint: "Open the site/address form." },
    { path: "extras.city", label: "City", area: "Site", kind: "single", keys: [{ key: "value", label: "City" }], hint: "Open the site/address form." },
    { path: "extras.state", label: "State / region", area: "Site", kind: "single", keys: [{ key: "value", label: "State or region" }], hint: "Open the site/address form." },
    { path: "extras.country", label: "Country", area: "Site", kind: "single", keys: [{ key: "value", label: "Country" }], hint: "Open the site/address form." },
    { path: "extras.postcode", label: "Postcode", area: "Site", kind: "single", keys: [{ key: "value", label: "Postcode" }], hint: "Open the site/address form." },
    { path: "extras.phone", label: "Phone", area: "Site", kind: "single", keys: [{ key: "value", label: "Phone number" }], hint: "Open the site/address form." },
    { path: "extras.fax", label: "Fax", area: "Site", kind: "single", keys: [{ key: "value", label: "Fax number" }], hint: "Open the site/address form." },
    { path: "extras.siteEmail", label: "Site email", area: "Site", kind: "single", keys: [{ key: "value", label: "Email address" }], hint: "Open the site/address form." },
    { path: "extras.startDate", label: "Start date", area: "Company", kind: "single", keys: [{ key: "value", label: "Start date / year" }], hint: "Open the Company tab where the start date is entered." },
    { path: "extras.industryCode", label: "Industry code", area: "Company", kind: "single", keys: [{ key: "value", label: "Code and name" }],
      hint: "Only a plain text box or native dropdown is supported; the layered industry picker is not." },
    { path: "extras.employeeCount", label: "Employee count", area: "Company", kind: "single", keys: [{ key: "value", label: "Employee count" }], hint: "Open the employee count field." },
    { path: "extras.verticals", label: "Verticals", area: "Company", kind: "list", keys: [{ key: "value", label: "Vertical" }],
      hint: "Only plain text boxes or native dropdowns with an Add button are supported." },
    { path: "extras.management", label: "Management", area: "Company", kind: "list", keys: [{ key: "fullName", label: "Full name" }, { key: "title", label: "Title" }],
      hint: "Management normally needs a person search and relationship steps; map it only if your page has a simple name + title form." }
  ];

  const byPath = new Map(FIELDS.map((f) => [f.path, f]));

  function get(path) {
    return byPath.get(path) || null;
  }

  function valueAt(doc, path) {
    return path.split(".").reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), doc);
  }

  // The records the agent produced for this field: [] when there are none.
  function recordsFor(doc, path) {
    const field = get(path);
    if (!field) return [];
    const value = valueAt(doc, path);
    if (value === undefined || value === null) return [];
    const list = field.kind === "single" ? [value] : Array.isArray(value) ? value : [];
    return list.filter((record) => record && typeof record === "object");
  }

  // A def key such as "companyBriefDescription" derived from the path.
  function keyFor(path) {
    return path.replace(/\.([a-z])/gi, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase());
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.outputFields = { FIELDS, get, recordsFor, keyFor, valueAt };
})();
