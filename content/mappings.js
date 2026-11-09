"use strict";

/*
 * "Mappings": one place that lists every data point and the steps used to fill it, so nobody has to guess how a field is
 * done. Built-in workflows come with their steps written out; mapped fields (taught by a researcher or shipped as team
 * defaults) have their steps worked out from the saved mapping. Read-only: nothing here changes a mapping.
 */
(() => {
  // How the built-in fields are filled (what the workflows do, in order).
  const BUILT_IN = [
    ["Name variations", "Business Entity", ["Show the Business Entity tab", "Open Name Variations, add a row for each name", "Pick the type (Legal, Familiar, Former, Other, Native Other)", "Save once", "Read the rows back before calling it saved"]],
    ["Website address, Email default structure", "Business Entity", ["Show the Business Entity tab", "Fill the Website Address box / pick the Email Default Structure", "Save changes (one Save shared by this whole group)", "Read the values back"]],
    ["Research notes (ANC mark and sources)", "Business Entity", ["Add the ANC mark, then the sources the report gave, after the existing text", "Existing text is never changed or removed", "Skip if AIGEN_SRX_V1_Y is already in the notes", "Save changes (the same shared Save)", "Read the text back"]],
    ["Financing, Research and Publish status", "Business Entity", ["Set Financing Status = Corporation, Research Status = Does Not Qualify for Meth./Not Act. Tracked, Publish Status = Publish", "A value that already matches is left alone; a different one is overwritten", "Save changes (the same shared Save)", "Read the values back"]],
    ["Ownership status history", "Business Entity", ["Date = the start date the report found, status = Privately Held", "A row that already matches is left alone", "Otherwise overwrite the current row, or Add New Ownership Status when the table is empty", "Save OSH", "Read the table back"]],
    ["Business status history", "Business Entity", ["Date = date of research (today), stage = Generating Revenue", "A row that already matches is left alone", "Otherwise overwrite the current row, or Add New Business Status when the table is empty", "Save BSH", "Read the table back"]],
    ["SIC codes", "Company", ["Open Industries and Verticals", "Add New SIC Industry Path, type the code, pick the source", "Save", "Read the row back"]],
    ["Site", "Company", ["Open the Site section, press Add New Site", "Fill every box (type Primary HQ, status Current, site name = city); Format links; address preview", "Press SAVE once (if another Primary HQ exists: Regional HQ)", "Read the Site list back"]],
    ["Verticals", "Company", ["Read the Published Verticals list; skip any already there", "Add New Vertical opens a window; find each vertical by name and press True", "Close the window and press the section's Save changes", "Read the Published list back"]]
  ];

  // The steps of a mapping, worked out from what was saved.
  function stepsOf(def) {
    const sel = (b) => (b ? `${b.text ? `"${b.text}"` : ""}${b.text && b.selectors?.[0] ? " " : ""}${b.selectors?.[0] ? `(${b.selectors[0]})` : ""}`.trim() : "");
    const steps = [];
    const tree = def.window?.tree;
    if (def.openButton) steps.push(`Open: press ${sel(def.openButton) || "the opening button"}${def.window ? " (a separate window opens)" : ""}`);
    if (tree) {
      steps.push(`Expand the branches: ${(tree.expander?.selectors || []).length ? `${tree.expander.selectors.length} kind(s) of + button` : "no + buttons (all choices are shown)"}`);
      steps.push("Find the choice by its code and name, tick it");
    } else if (def.window?.rows) {
      steps.push("Find each row by its name and press its button");
    } else if (def.tree) {
      steps.push("Open the dialog, expand the branches, pick the code");
    } else {
      for (const field of def.fields || []) steps.push(`Fill "${field.label || field.key}" (${field.kind})${field.selectors?.[0] ? `: ${field.selectors[0]}` : ""}`);
    }
    for (const button of def.window?.preSave || []) steps.push(`Press before Save: ${sel(button)}`);
    if (def.saveButton) steps.push(`Save: press ${sel(def.saveButton) || "the Save button"}`);
    steps.push(tree ? "Open the window again and read the tick back" : "Read the value back");
    return steps;
  }

  const CSS = `
    .mp-modal { display: none; position: fixed; z-index: 2147483648; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
    .mp-modal.open { display: flex; }
    .mp-card { background: #fff; border-radius: 14px; width: min(680px, 94vw); max-height: 90vh; overflow: auto; padding: 20px 22px; box-shadow: 0 20px 48px rgba(15,30,60,.28); }
    .mp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e6ed; }
    .mp-head h2 { margin: 0; font-size: 16px; }
    .mp-x { background: none; border: 0; font-size: 24px; line-height: 1; color: #7a869c; cursor: pointer; }
    .mp-section { margin: 14px 0; }
    .mp-section h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; color: #124a80; }
    .mp-item { border: 1px solid #e2e6ed; border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
    .mp-muted { color: #7a869c; font-size: 12px; }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    for (const child of children) node.appendChild(child);
    return node;
  }

  function mount(shadow) {
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    const modal = el("div", { className: "mp-modal" });
    const card = el("div", { className: "mp-card" });
    modal.appendChild(card);
    const close = () => modal.classList.remove("open");
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

    function entry(title, where, steps, note = "") {
      const list = el("ol", { className: "mp-muted" }, steps.map((s) => el("li", { text: s })));
      list.style.margin = "4px 0 0 18px";
      return el("div", { className: "mp-item" }, [el("div", {}, [el("b", { text: title }), el("span", { className: "mp-muted", text: `  ·  ${where}${note ? `  ·  ${note}` : ""}` }), list])]);
    }

    function render() {
      card.textContent = "";
      const x = el("button", { className: "mp-x", text: "×" });
      x.type = "button";
      x.addEventListener("click", close);
      card.appendChild(el("div", { className: "mp-head" }, [el("h2", { text: "Mappings: how every field is filled" }), x]));
      card.appendChild(el("p", { className: "mp-muted", text: "Read-only. Built-in fields work on their own; mapped fields were taught by a researcher or came with the team defaults. Nothing here changes a mapping." }));

      const mapped = (globalThis.SXRTS.customFields?.getCached?.() ?? []).filter((d) => d && d.key);
      const builtSection = el("div", { className: "mp-section" }, [el("h3", { text: `Built in (${BUILT_IN.length})` })]);
      for (const [title, where, steps] of BUILT_IN) builtSection.appendChild(entry(title, where, steps));
      const mappedSection = el("div", { className: "mp-section" }, [el("h3", { text: `Mapped fields (${mapped.length})` })]);
      if (!mapped.length) mappedSection.appendChild(el("p", { className: "mp-muted", text: "No mapped fields on this browser." }));
      for (const def of mapped) {
        const source = globalThis.SXRTS.customFields?.isFromTeam?.(def) ? "team default" : "mapped here";
        mappedSection.appendChild(entry(def.label || def.key, `${def.binds?.path || "taught field"}`, stepsOf(def), source));
      }
      card.appendChild(builtSection);
      card.appendChild(mappedSection);

      const rules = globalThis.SXRTS.outputRules?.getCached?.() ?? [];
      const rulesSection = el("div", { className: "mp-section" }, [el("h3", { text: `Output rules (${rules.length})` })]);
      if (!rules.length) rulesSection.appendChild(el("p", { className: "mp-muted", text: "No output rules." }));
      for (const rule of rules) rulesSection.appendChild(entry(rule.label || rule.id, rule.target, [globalThis.SXRTS.outputRules.describeSteps?.(rule.steps || []) || "(no steps)"], rule.enabled === false ? "off" : "on"));
      card.appendChild(rulesSection);
      card.appendChild(el("div", { className: "mp-section" }, [el("h3", { text: "Also on every profile" }), el("p", { className: "mp-muted", text: "The full description starts with the brief description. Financing, Research and Publish status and the two status histories are set as listed above." })]));
    }

    shadow.appendChild(modal);
    return { open() { render(); modal.classList.add("open"); }, close, render };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.mappingsUi = { mount, stepsOf, BUILT_IN };
})();
