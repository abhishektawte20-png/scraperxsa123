"use strict";

/*
 * One text report of everything that went wrong or was left undone in a run:
 * validation errors and warnings, rows that failed, rows that were skipped
 * and why, rows that cannot run yet, and the mappings in use. It is meant to
 * be pasted to the developer as the baseline for the next update, so every
 * item carries the message exactly as the page showed it, the value involved,
 * and a likely cause. A JSON copy of the same items is appended.
 */
(() => {
  // Likely causes, matched against the message. Order matters: first match wins.
  const CAUSES = [
    [/did not appear after clicking Add.*tag box/i, "The field is a tag box (type a word, press Enter). Tag boxes are not supported yet; the HTML of the box with one tag in it is needed."],
    [/Could not find the "View All Name Variations"|Add New Name Variation button was not found/i, "The Name Variations controls are not on screen: the section is closed or this is not the Business Entity > Entity view."],
    [/Add New Sic Industry Path button was not found/i, "The SIC section is closed or this is not the Company tab."],
    [/Website Address field was not found/i, "The Website Address box is not on screen: open the Business Entity tab and its Entity section."],
    [/No row labelled/i, "The list (for example social media networks) is not open on the page, or RTS labels that row differently."],
    [/saved value no longer matches/i, "RTS changed or cut the text after Save (length limit or rewritten characters). Compare the two lengths and the first difference in the message."],
    [/already has a value/i, "Not an error: the RTS field already had a value and the action was addIfMissing, so nothing was overwritten."],
    [/No selector registry entry exists/i, "Not an error: this value has no RTS field mapped yet. Use Map this field on its row."],
    [/was not found on this page|button.*was not found/i, "A mapped control is not on screen. Open the right tab or section, or re-map the field."],
    [/popup|window did not open|No popup window/i, "The popup or window did not open. If Chrome blocked it, allow pop-ups for rts.pitchbook.com."],
    [/NAICS code .* is not in RTS/i, "RTS's NAICS list does not contain that code."],
    [/Save button.*disabled|did not become active/i, "RTS did not register the change, so its Save button never woke up."],
    [/EXTERNAL_SOURCE|sourced from/i, "The agent used another site as a source. Check it is the company's own page."]
  ];

  const causeFor = (message) => CAUSES.find(([pattern]) => pattern.test(message || ""))?.[1] ?? "";
  const clip = (text, n = 300) => (String(text).length > n ? `${String(text).slice(0, n)}…` : String(text));

  function show(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return clip(value);
    try {
      const { action, ...rest } = value;
      return clip(JSON.stringify(rest));
    } catch {
      return "";
    }
  }

  function describeDefinition(def) {
    const sel = (b) => (b ? `${(b.selectors || []).slice(0, 2).join(" | ")}${b.text ? ` ("${b.text}")` : ""}` : "");
    const parts = [`${def.kind}`];
    if (def.fromTeam) parts.push("team default");
    if (def.window) parts.push("separate window");
    else if (def.tree) parts.push("tree picker");
    else if (def.openButton) parts.push("popup");
    if (def.openButton) parts.push(`opens with ${sel(def.openButton)}`);
    if (def.addButton) parts.push(`Add ${sel(def.addButton)}`);
    if (def.tree) parts.push(`+ ${(def.tree.expander?.selectors || []).slice(0, 1).join("")}, choice ${(def.tree.leaf?.selectors || []).slice(0, 1).join("")}, section Save ${sel(def.tree.sectionSave)}`);
    if (def.fields?.length && !def.tree) parts.push(`fields ${def.fields.map((f) => `${f.key}=${(f.selectors || []).slice(0, 1).join("")}`).join(", ")}`);
    if (def.saveButton) parts.push(`Save ${sel(def.saveButton)}`);
    return parts.join("; ");
  }

  // input: { version, now, pageUrl, domain, companyName, pbid, validation: { ok, headline, lines },
  //          actions, definitions, team }
  function build(input) {
    const { version, now = new Date(), pageUrl = "", domain = "", companyName = "", pbid = "", validation = null, actions = [], definitions = [], team = null } = input;
    const lines = [];
    const items = [];
    const add = (...text) => lines.push(...text);

    const failed = actions.filter((a) => a.executionStatus === "failed");
    const saved = actions.filter((a) => a.executionStatus === "savedValueVerified");
    const ranAndSkipped = actions.filter((a) => a.executionStatus === "skipped" && a.resultMessage);
    const notMapped = actions.filter((a) => a.executionStatus === "skipped" && !a.resultMessage);
    const notPublished = actions.filter((a) => a.executionStatus === "pending");

    add(`ScraperX issue report${version ? ` · v${version}` : ""}`);
    add(`Created: ${now.toISOString()}`);
    if (pageUrl) add(`Page: ${pageUrl}`);
    add(`Company: ${[companyName, domain, pbid ? `PBID ${pbid}` : ""].filter(Boolean).join(" · ") || "(not identified)"}`);
    if (team) add(`Team defaults: ${team.mappings} mapping(s), ${team.rules} rule(s)${team.exportedAt ? `, exported ${team.exportedAt.slice(0, 10)}` : ""}`);
    add("");

    add("SUMMARY");
    add(`Validation: ${validation ? `${validation.ok ? "valid" : "FAILED"} · ${validation.headline}` : "not run"}`);
    add(`Publish: ${saved.length} saved, ${ranAndSkipped.length} skipped, ${failed.length} failed, ${notMapped.length} not mapped yet, ${notPublished.length} not published`);
    add("");

    const validationLines = validation?.lines ?? [];
    const errors = validationLines.filter((l) => l.kind === "err");
    const warnings = validationLines.filter((l) => l.kind === "warn");
    if (errors.length) {
      add(`VALIDATION ERRORS (${errors.length})`);
      errors.forEach((l, i) => { add(`${i + 1}. ${l.text}`); items.push({ type: "validation-error", message: l.text }); });
      add("");
    }
    if (warnings.length) {
      add(`VALIDATION WARNINGS (${warnings.length})`);
      warnings.forEach((l, i) => { add(`${i + 1}. ${l.text}`); items.push({ type: "validation-warning", message: l.text }); });
      add("");
    }

    // Rows with the same field and the same message are listed once, with a
    // count and their values, so ten keywords do not take ten paragraphs.
    const itemLines = (title, list, type, withCause) => {
      if (!list.length) return;
      add(`${title} (${list.length})`);
      const groups = [];
      for (const a of list) {
        const message = a.resultMessage || a.skipReason || "";
        const group = groups.find((g) => g.path === a.jsonPath && g.message === message);
        if (group) group.rows.push(a);
        else groups.push({ path: a.jsonPath, message, rows: [a] });
      }
      groups.forEach((group, i) => {
        const first = group.rows[0];
        add(`${i + 1}. ${group.path}${group.rows.length > 1 ? ` ×${group.rows.length}` : ""}${first.customKey ? ` · mapped field "${first.section || first.customKey}"` : first.section ? ` · ${first.section}` : ""}`);
        add(`   Message: ${group.message || "(none)"}`);
        const values = group.rows.map((a) => show(a.proposedValue)).filter(Boolean);
        if (values.length === 1) add(`   Value: ${values[0]}`);
        else if (values.length > 1) add(`   Values: ${values.slice(0, 6).map((v) => clip(v, 120)).join(" | ")}${values.length > 6 ? ` … (+${values.length - 6} more)` : ""}`);
        const cause = withCause ? causeFor(group.message) : "";
        if (cause) add(`   Likely cause: ${cause}`);
        const def = first.customKey ? definitions.find((d) => d.key === first.customKey) : null;
        if (def && type === "failed") add(`   Mapping: ${describeDefinition(def)}`);
        for (const a of group.rows) items.push({ type, path: a.jsonPath, message: group.message, value: show(a.proposedValue), ...(def ? { mapping: def.key } : {}) });
      });
      add("");
    };
    itemLines("FAILED", failed, "failed", true);
    itemLines("SKIPPED (the run reached these and left them alone)", ranAndSkipped, "skipped", true);
    itemLines("NOT MAPPED YET (no RTS field known for these)", notMapped, "not-mapped", false);
    itemLines("NOT PUBLISHED (ready, but not ticked or not run)", notPublished, "not-published", false);

    const stateOnly = saved.filter((a) => a.resultMessage);
    if (stateOnly.length) {
      add(`SAVED, BUT NOT READ BACK (${stateOnly.length})`);
      stateOnly.forEach((a, i) => { add(`${i + 1}. ${a.jsonPath}: ${a.resultMessage}`); items.push({ type: "saved-state-only", path: a.jsonPath, message: a.resultMessage }); });
      add("");
    }

    if (definitions.length) {
      add(`MAPPINGS IN USE (${definitions.length})`);
      definitions.forEach((d) => add(`- ${d.label} [${d.key}]: ${describeDefinition(d)}`));
      add("");
    }

    add("JSON");
    add(JSON.stringify({ version: version || null, createdAt: now.toISOString(), domain, pbid, counts: { saved: saved.length, skipped: ranAndSkipped.length, failed: failed.length, notMapped: notMapped.length, notPublished: notPublished.length }, items }, null, 2));
    return { text: lines.join("\n"), counts: { failed: failed.length, skipped: ranAndSkipped.length, errors: errors.length, warnings: warnings.length, notMapped: notMapped.length } };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.issueReport = { build, causeFor, describeDefinition };
})();
