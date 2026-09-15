"use strict";

/*
 * ScraperX RTS Profile Assistant panel: identify the profile, build a
 * Rovo prompt, validate the pasted response, preview every proposed
 * change (editable, selectable), then publish only after explicit
 * confirmation. Every publish is profile-scoped-cached so it can be
 * cleared or reviewed later; nothing is ever applied without a fresh
 * identity-lock check first.
 */
(() => {
  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.id) node.id = options.id;
    if (options.placeholder) node.placeholder = options.placeholder;
    if (options.type) node.type = options.type;
    if (options.title) node.title = options.title;
    if (options.value !== undefined) node.value = options.value;
    if (options.checked !== undefined) node.checked = options.checked;
    if (options.disabled !== undefined) node.disabled = options.disabled;
    if (options.rows) node.rows = options.rows;
    for (const child of children) node.appendChild(child);
    return node;
  }

  function formatTimestamp(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function mount(shadow) {
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        position: fixed; z-index: 2147483647; right: 18px; top: 18px;
        width: min(600px, calc(100vw - 36px)); max-height: calc(100vh - 36px); overflow: auto;
        background: #ffffff; color: #1b2430; border: 1px solid #e2e6ed; border-radius: 14px;
        box-shadow: 0 20px 48px rgba(15, 30, 60, .22), 0 2px 8px rgba(15,30,60,.10);
        font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .head {
        position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
        padding: 16px 18px; background: linear-gradient(135deg, #0b2f52, #124a80); color: #fff;
        border-radius: 13px 13px 0 0;
      }
      .brand { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
      .brand-mark {
        width: 30px; height: 30px; border-radius: 8px; background: rgba(255,255,255,.14);
        display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px;
        letter-spacing: -0.5px; flex-shrink: 0;
      }
      .brand-text h1 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .1px; }
      .brand-text p { margin: 1px 0 0; font-size: 11px; color: rgba(255,255,255,.72); }
      .close {
        width: 28px; height: 28px; border: 0; border-radius: 7px; background: rgba(255,255,255,.12);
        color: #fff; font-size: 18px; line-height: 1; cursor: pointer; flex-shrink: 0;
      }
      .close:hover { background: rgba(255,255,255,.22); }

      .steps { display: flex; padding: 12px 18px 0; gap: 4px; }
      .step {
        flex: 1; text-align: center; font-size: 10.5px; font-weight: 650; color: #8993a4;
        padding: 7px 4px; border-bottom: 2.5px solid #e2e6ed; text-transform: uppercase; letter-spacing: .3px;
      }
      .step.active { color: #124a80; border-bottom-color: #124a80; }
      .step.done { color: #1a8a5f; border-bottom-color: #1a8a5f; }

      .body { padding: 16px 18px 20px; }
      .card {
        border: 1px solid #e6e9ef; border-radius: 10px; padding: 14px; margin: 0 0 14px; background: #fbfcfe;
      }
      .card h2 {
        margin: 0 0 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
        color: #47536b;
      }
      .notice {
        margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; border-left: 3px solid #b8860b;
        background: #fff8e6; color: #6b5100; font-size: 12px;
      }
      .cache-notice {
        margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; border-left: 3px solid #124a80;
        background: #eef5fc; color: #0b2f52; font-size: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      }
      .cache-notice .spacer { flex: 1; }

      .field { margin: 0 0 10px; }
      .field:last-child { margin-bottom: 0; }
      label { display: block; margin: 0 0 4px; font-weight: 650; font-size: 12px; color: #33405a; }
      input[type="text"], input:not([type]), textarea, select {
        width: 100%; border: 1px solid #ccd3de; border-radius: 7px; padding: 7px 9px; font: inherit;
        background: #fff; color: #1b2430;
      }
      input:focus, textarea:focus, select:focus { outline: 2px solid #124a80; outline-offset: 1px; }
      textarea { min-height: 96px; resize: vertical; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; }
      #sxrts-response { min-height: 130px; }

      .row { display: flex; gap: 8px; }
      .row > * { flex: 1; }

      .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      button.btn {
        border: 1px solid #124a80; border-radius: 7px; padding: 8px 14px; background: #124a80; color: #fff;
        font: 650 12.5px/1.2 inherit; cursor: pointer; transition: background .12s;
      }
      button.btn:hover:not(:disabled) { background: #0d3a66; }
      button.btn.secondary { background: #fff; color: #124a80; }
      button.btn.secondary:hover:not(:disabled) { background: #eef5fc; }
      button.btn.danger { background: #fff; color: #a3291c; border-color: #d8b3ac; }
      button.btn.danger:hover:not(:disabled) { background: #fdf1ef; }
      button.btn.primary-cta { background: #1a8a5f; border-color: #1a8a5f; padding: 10px 18px; font-size: 13px; }
      button.btn.primary-cta:hover:not(:disabled) { background: #166f4c; }
      button.btn:disabled { opacity: .45; cursor: not-allowed; }

      .status { min-height: 18px; margin: 4px 0 0; color: #47536b; white-space: pre-wrap; font-size: 12px; }
      .status.error { color: #a3291c; }
      .status.success { color: #166f4c; }

      .action-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; max-height: 440px; overflow-y: auto; padding-right: 2px; }
      .action-card { border: 1px solid #e2e6ed; border-radius: 8px; padding: 10px 12px; background: #fff; }
      .action-card-skipped { opacity: .6; background: #fbfcfe; }
      .action-card-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
      .action-card-head input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; width: auto; }
      .action-card-title { flex: 1; min-width: 0; }
      .action-card-field { font-weight: 700; font-size: 12px; color: #1b2430; overflow-wrap: anywhere; }
      .action-card-area { font-size: 10.5px; color: #7a869c; text-transform: uppercase; letter-spacing: .3px; margin-top: 1px; }
      .value-fields { display: flex; flex-direction: column; gap: 6px; padding-left: 24px; }
      .value-field { display: grid; grid-template-columns: 88px 1fr; gap: 8px; align-items: start; }
      .value-field-label { font-size: 10.5px; font-weight: 650; color: #7a869c; text-transform: uppercase; letter-spacing: .2px; padding-top: 7px; }
      .value-field input, .value-field textarea { font-size: 12px; }
      .action-reason { padding-left: 24px; margin-top: 6px; font-size: 11px; color: #974f0c; }
      .badge { display: inline-block; padding: 2px 7px; border-radius: 100px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .2px; flex-shrink: 0; }
      .badge-pending { background: #eef5fc; color: #124a80; }
      .badge-skipped { background: #eef0f4; color: #7a869c; }
      .badge-saved { background: #e5f6ee; color: #166f4c; }
      .badge-failed { background: #fdecea; color: #a3291c; }
      .hidden { display: none; }
      .helptext { font-size: 11px; color: #7a869c; margin-top: 6px; }
    `;
    shadow.appendChild(style);

    // ---------- Header ----------
    const panel = element("div", { className: "panel" });
    const closeButton = element("button", { className: "close", text: "×", type: "button", title: "Close" });
    panel.appendChild(element("div", { className: "head" }, [
      element("div", { className: "brand" }, [
        element("div", { className: "brand-mark", text: "SX" }),
        element("div", { className: "brand-text" }, [
          element("h1", { text: "ScraperX" }),
          element("p", { text: "RTS Profile Assistant" })
        ])
      ]),
      closeButton
    ]));

    const stepBar = element("div", { className: "steps" });
    const steps = ["Identify", "Research", "Validate", "Preview & publish"];
    const stepEls = steps.map((label) => element("div", { className: "step", text: label }));
    for (const el of stepEls) stepBar.appendChild(el);
    panel.appendChild(stepBar);

    function setStep(index) {
      stepEls.forEach((el, i) => {
        el.classList.toggle("active", i === index);
        el.classList.toggle("done", i < index);
      });
    }
    setStep(0);

    const body = element("div", { className: "body" });
    body.appendChild(element("p", { className: "notice", text: "5 fields are live end to end: Name Variations, Website Address, Email Default Structure, Research Notes, and SIC codes. Everything else previews only — see docs/evidence-checklist.md." }));

    const cacheNotice = element("div", { className: "cache-notice hidden" });
    body.appendChild(cacheNotice);

    // ---------- Card 1: identity + prompt ----------
    const identityCard = element("div", { className: "card" });
    identityCard.appendChild(element("h2", { text: "1 · Identify the company" }));

    let readIdentity = { companyName: "", domain: "" };
    try {
      const rts = globalThis.SXRTS.identityLock.readRtsIdentityFromPage();
      readIdentity = { companyName: rts.companyName || "", domain: rts.domain || "" };
    } catch {
      // Not on a recognizable RTS Business Entity page yet; leave blank for manual entry.
    }

    const companyNameInput = element("input", { id: "sxrts-company-name", value: readIdentity.companyName });
    const companyNameLabel = element("label", { text: "Company name" });
    companyNameLabel.htmlFor = "sxrts-company-name";
    const domainInput = element("input", { id: "sxrts-domain", value: readIdentity.domain });
    const domainLabel = element("label", { text: "Official website" });
    domainLabel.htmlFor = "sxrts-domain";
    identityCard.appendChild(element("div", { className: "row" }, [
      element("div", { className: "field" }, [companyNameLabel, companyNameInput]),
      element("div", { className: "field" }, [domainLabel, domainInput])
    ]));

    const promptLabel = element("label", { text: "Prompt for ScraperX" });
    const promptArea = element("textarea", { id: "sxrts-prompt" });
    promptArea.readOnly = true;
    identityCard.appendChild(element("div", { className: "field" }, [promptLabel, promptArea]));

    function regeneratePrompt() {
      promptArea.value = globalThis.SXRTS.promptBuilder.buildPrompt({
        companyName: companyNameInput.value.trim(),
        domain: domainInput.value.trim()
      });
    }
    regeneratePrompt();
    companyNameInput.addEventListener("input", regeneratePrompt);
    domainInput.addEventListener("input", regeneratePrompt);

    const copyPromptButton = element("button", { className: "btn", text: "Copy prompt", type: "button" });
    const openRovoButton = element("button", { className: "btn secondary", text: "Open Rovo", type: "button" });
    const copyAgentSetupButton = element("button", { className: "btn secondary", text: "Copy agent setup instructions", type: "button", title: "One-time setup: paste this into the ScraperX Rovo agent's own configuration, not into a chat message." });
    identityCard.appendChild(element("div", { className: "buttons" }, [copyPromptButton, openRovoButton, copyAgentSetupButton]));
    identityCard.appendChild(element("p", { className: "helptext", text: "If Rovo keeps replying with a prose report instead of JSON, the agent's own configuration needs the \"agent setup instructions\" pasted in once (see docs/rovo-agent-instructions.md) — a per-run prompt alone can't override it." }));
    body.appendChild(identityCard);

    // ---------- Card 2: paste + validate ----------
    const jsonCard = element("div", { className: "card" });
    jsonCard.appendChild(element("h2", { text: "2-3 · Research in Rovo, then paste the result" }));
    const responseLabel = element("label", { text: "Paste ScraperX Rovo JSON response" });
    const textarea = element("textarea", { id: "sxrts-response", placeholder: "Paste one JSON object here. Nothing is read from your clipboard automatically." });
    jsonCard.appendChild(element("div", { className: "field" }, [responseLabel, textarea]));
    const validateButton = element("button", { className: "btn", text: "Validate JSON", type: "button" });
    jsonCard.appendChild(element("div", { className: "buttons" }, [validateButton]));
    const validateStatus = element("div", { className: "status" });
    jsonCard.appendChild(validateStatus);
    body.appendChild(jsonCard);

    // ---------- Card 3: preview + publish ----------
    const previewCard = element("div", { className: "card hidden" });
    previewCard.appendChild(element("h2", { text: "4 · Preview, edit if needed, then publish" }));
    previewCard.appendChild(element("p", { className: "helptext", text: "Uncheck anything you don't want applied. Edit a field directly if only a small correction is needed — it's re-validated when you publish." }));
    const actionList = element("div", { className: "action-list" });
    previewCard.appendChild(actionList);
    const selectAllButton = element("button", { className: "btn secondary", text: "Select all pending", type: "button" });
    const publishButton = element("button", { className: "btn primary-cta", text: "Publish selected to RTS", type: "button" });
    const clearCacheButton = element("button", { className: "btn danger", text: "Clear cache for this profile", type: "button" });
    previewCard.appendChild(element("div", { className: "buttons" }, [selectAllButton, publishButton, clearCacheButton]));
    const publishStatus = element("div", { className: "status" });
    previewCard.appendChild(publishStatus);
    body.appendChild(previewCard);

    let lastValidated = null;
    let lastActions = [];
    const rowsByActionId = new Map();

    function setStatus(el, text, type = "") {
      el.textContent = text;
      el.className = `status${type ? ` ${type}` : ""}`;
    }

    function currentIdentity() {
      return lastValidated?.profileIdentity ?? { companyName: companyNameInput.value.trim(), domain: domainInput.value.trim() };
    }

    async function refreshCacheNotice() {
      try {
        const identity = currentIdentity();
        const cached = await globalThis.SXRTS.cache.getProfileCache(identity);
        if (cached) {
          cacheNotice.replaceChildren(
            element("span", { text: `Cached plan found for this profile (last updated ${formatTimestamp(cached.lastUpdated)}).` }),
            element("span", { className: "spacer" }),
          );
        } else {
          cacheNotice.classList.add("hidden");
        }
        cacheNotice.classList.toggle("hidden", !cached);
      } catch {
        cacheNotice.classList.add("hidden");
      }
    }
    refreshCacheNotice();

    copyPromptButton.addEventListener("click", async () => {
      regeneratePrompt();
      try {
        await navigator.clipboard.writeText(promptArea.value);
        setStatus(validateStatus, "Prompt copied. Paste it into ScraperX in Rovo.", "success");
      } catch {
        promptArea.focus();
        promptArea.select();
        setStatus(validateStatus, "Copy was blocked by the browser. The prompt is selected; press Ctrl+C.", "error");
      }
      setStep(1);
    });
    openRovoButton.addEventListener("click", () => {
      window.open("https://pitchbook.atlassian.net/", "_blank", "noopener,noreferrer");
      setStep(1);
    });

    copyAgentSetupButton.addEventListener("click", async () => {
      const instructions = globalThis.SXRTS.promptBuilder.buildAgentInstructions();
      try {
        await navigator.clipboard.writeText(instructions);
        setStatus(validateStatus, "Agent setup instructions copied. Paste them into the ScraperX agent's own configuration in Rovo (one-time setup) — not into a chat message.", "success");
      } catch {
        setStatus(validateStatus, "Copy was blocked by the browser. Open docs/rovo-agent-instructions.md instead.", "error");
      }
    });

    // Fields with a fixed, known set of legal values are rendered as a
    // <select> instead of free text, so a manual correction can't
    // introduce a typo the workflow would otherwise reject (or worse,
    // silently mis-handle) deep inside a live DOM write. "action" and
    // "confidence" are universal schema enums; the rest are real RTS
    // dropdown catalogs already evidenced in the registry.
    function fieldOptionsFor(jsonPath, key) {
      if (key === "action") {
        return { values: Array.from(globalThis.SXRTS.schema.ACTIONS), allowBlank: false };
      }
      if (key === "confidence") {
        return { values: Array.from(globalThis.SXRTS.schema.CONFIDENCE_LEVELS), allowBlank: true };
      }
      if (jsonPath === "businessEntity.nameVariations" && key === "type") {
        const options = globalThis.SXRTS.registry.getField(jsonPath)?.form?.typeDropdown?.options?.map((o) => o.label);
        return options ? { values: options, allowBlank: false } : null;
      }
      if (jsonPath === "company.sicCodes" && key === "classificationSource") {
        const options = globalThis.SXRTS.registry.getField(jsonPath)?.form?.sourceDropdown?.options?.map((o) => o.label);
        return options ? { values: options, allowBlank: true } : null;
      }
      if (jsonPath === "businessEntity.emailDefaultStructure" && key === "value") {
        const options = globalThis.SXRTS.registry.getField(jsonPath)?.form?.select?.options?.map((o) => o.label);
        return options ? { values: options, allowBlank: true } : null;
      }
      return null;
    }

    // Renders one proposed value as labeled, individually editable fields
    // (name/type/source/... for a record, or a single input for a plain
    // string) instead of a raw JSON blob — readable, and there's no
    // JSON.parse involved, so an edit can never be silently discarded.
    function buildValueEditor(proposedValue, jsonPath) {
      const wrap = element("div", { className: "value-fields" });

      if (proposedValue === null || typeof proposedValue !== "object") {
        const input = element("input", { value: proposedValue === null || proposedValue === undefined ? "" : String(proposedValue) });
        wrap.appendChild(input);
        return {
          element: wrap,
          getValue: () => input.value,
          setDisabled: (disabled) => { input.disabled = disabled; }
        };
      }

      const fields = [];
      for (const [key, val] of Object.entries(proposedValue)) {
        const fieldRow = element("div", { className: "value-field" });
        const label = element("span", { className: "value-field-label", text: key });
        const currentText = val === null || val === undefined ? "" : String(val);
        const options = fieldOptionsFor(jsonPath, key);

        let input;
        if (options) {
          input = element("select", {});
          if (options.allowBlank) input.appendChild(element("option", { value: "", text: "(none)" }));
          for (const optionLabel of options.values) {
            input.appendChild(element("option", { value: optionLabel, text: optionLabel }));
          }
          const matched = options.values.find((v) => v.toLowerCase() === currentText.toLowerCase());
          input.value = matched || (options.allowBlank ? "" : options.values[0]);
        } else {
          const isLongText = typeof val === "string" && val.length > 60;
          input = isLongText ? element("textarea", { value: val, rows: 2 }) : element("input", { value: currentText });
        }

        fields.push({ key, input, type: typeof val });
        fieldRow.appendChild(label);
        fieldRow.appendChild(input);
        wrap.appendChild(fieldRow);
      }

      return {
        element: wrap,
        getValue: () => {
          const out = {};
          for (const { key, input, type } of fields) {
            const raw = input.value;
            if (raw.trim() === "") { out[key] = null; continue; }
            if (type === "boolean") { out[key] = raw.trim().toLowerCase() === "true"; continue; }
            if (type === "number") {
              const n = Number(raw);
              out[key] = Number.isNaN(n) ? raw : n;
              continue;
            }
            out[key] = raw;
          }
          return out;
        },
        setDisabled: (disabled) => { for (const { input } of fields) input.disabled = disabled; }
      };
    }

    function renderActionRow(action) {
      const isRunnable = action.executionStatus === "pending";
      const checkbox = element("input", { type: "checkbox", checked: isRunnable, disabled: !isRunnable });
      const editor = buildValueEditor(action.proposedValue, action.jsonPath);
      if (!isRunnable) editor.setDisabled(true);

      const statusBadge = element("span", { className: `badge badge-${isRunnable ? "pending" : "skipped"}`, text: action.executionStatus });
      const reasonEl = element("div", { className: "action-reason", text: action.skipReason || "" });

      const head = element("div", { className: "action-card-head" }, [
        checkbox,
        element("div", { className: "action-card-title" }, [
          element("div", { className: "action-card-field", text: `${action.jsonPath}${action.recordIndex !== null ? `[${action.recordIndex}]` : ""}` }),
          element("div", { className: "action-card-area", text: action.area || "(unregistered)" })
        ]),
        statusBadge
      ]);

      const card = element("div", { className: `action-card${isRunnable ? "" : " action-card-skipped"}` }, [head, editor.element, reasonEl]);

      rowsByActionId.set(action.actionId, {
        card, action, checkbox, statusBadge, reasonEl, editor,
        getEditedValue: editor.getValue
      });
      return card;
    }

    function setRowStatus(actionId, statusText, reasonText) {
      const entry = rowsByActionId.get(actionId);
      if (!entry) return;
      entry.action.executionStatus = statusText;
      entry.statusBadge.textContent = statusText;
      entry.statusBadge.className = `badge badge-${statusText === "savedValueVerified" ? "saved" : statusText === "failed" ? "failed" : "skipped"}`;
      entry.reasonEl.textContent = reasonText || "";
      entry.checkbox.checked = false;
      entry.checkbox.disabled = true;
      entry.editor.setDisabled(true);
    }

    async function persistToCache() {
      try {
        await globalThis.SXRTS.cache.setProfileCache(currentIdentity(), {
          schemaVersion: lastValidated?.schemaVersion ?? "1.0",
          executionPlan: lastActions.map((a) => ({ actionId: a.actionId, jsonPath: a.jsonPath, area: a.area, executionStatus: a.executionStatus, skipReason: a.skipReason }))
        });
        refreshCacheNotice();
      } catch {
        // Identity not resolvable yet (e.g. manual entry without a strong identifier) — cache is best-effort.
      }
    }

    function buildPlan() {
      lastActions = globalThis.SXRTS.executionPlan.buildExecutionPlan(lastValidated);
      rowsByActionId.clear();
      actionList.replaceChildren();
      for (const action of lastActions) actionList.appendChild(renderActionRow(action));
      previewCard.classList.remove("hidden");
      const skippedCount = lastActions.filter((a) => a.executionStatus === "skipped").length;
      const runnable = lastActions.length - skippedCount;
      setStatus(publishStatus, `${lastActions.length} proposed change(s): ${runnable} ready to publish, ${skippedCount} skipped (not yet supported for automation).`, "");
      publishButton.disabled = runnable === 0;
      setStep(3);
      persistToCache();
    }

    validateButton.addEventListener("click", () => {
      try {
        lastValidated = globalThis.SXRTS.schema.validate(textarea.value);
        const warningText = lastValidated.warnings.length ? `\nWarnings:\n- ${lastValidated.warnings.join("\n- ")}` : "";
        setStatus(validateStatus, `Valid (schema ${lastValidated.schemaVersion}). Building preview...${warningText}`, "success");
        setStep(2);
        buildPlan();
      } catch (error) {
        lastValidated = null;
        previewCard.classList.add("hidden");
        setStatus(validateStatus, error instanceof globalThis.SXRTS.schema.SchemaValidationError ? error.errors.join("\n") : String(error), "error");
      }
    });

    selectAllButton.addEventListener("click", () => {
      for (const { checkbox, action } of rowsByActionId.values()) {
        if (action.executionStatus === "pending") checkbox.checked = true;
      }
    });

    clearCacheButton.addEventListener("click", async () => {
      try {
        await globalThis.SXRTS.cache.clearProfileCache(currentIdentity());
        setStatus(publishStatus, "Cache cleared for this profile.", "success");
        cacheNotice.classList.add("hidden");
      } catch (error) {
        setStatus(publishStatus, `Could not clear cache: ${error.message}`, "error");
      }
    });

    publishButton.addEventListener("click", async () => {
      const selected = Array.from(rowsByActionId.values()).filter((entry) => entry.checkbox.checked && !entry.checkbox.disabled);
      if (!selected.length) {
        setStatus(publishStatus, "Nothing selected to publish.", "error");
        return;
      }
      if (!window.confirm(`Publish ${selected.length} field(s) to RTS now? This makes live changes.`)) {
        return;
      }

      publishButton.disabled = true;
      clearCacheButton.disabled = true;

      let rtsIdentity;
      try {
        rtsIdentity = globalThis.SXRTS.identityLock.readRtsIdentityFromPage();
      } catch (error) {
        setStatus(publishStatus, `Blocked: ${error.message}`, "error");
        publishButton.disabled = false;
        clearCacheButton.disabled = false;
        return;
      }

      const identityResult = globalThis.SXRTS.identityLock.compareIdentity(lastValidated.profileIdentity, rtsIdentity);
      // An active conflict (e.g. the domains disagree) is never overridable
      // — that's the strongest signal this might be the wrong profile.
      if (identityResult.status === "mismatch") {
        setStatus(publishStatus, `Blocked by identity lock:\n${identityResult.reasons.join("\n")}`, "error");
        publishButton.disabled = false;
        clearCacheButton.disabled = false;
        return;
      }
      // No active conflict, but also nothing strong (PBID/domain) to
      // compare — common for a real profile that just hasn't had its
      // domain filled in yet, since Rovo can never know an RTS PBID on
      // its own. Rather than a hard block or a silent bypass, ask the
      // researcher to look at both sides and explicitly confirm — the
      // same human-in-the-loop principle used for the publish step itself.
      if (identityResult.status === "insufficient") {
        const json = lastValidated.profileIdentity;
        const confirmed = window.confirm(
          "No PBID or domain match was found to automatically confirm this is the right RTS profile.\n\n" +
          `Open RTS profile: PBID ${rtsIdentity.pbId || "(none)"} · formal name "${rtsIdentity.formalName || "(none)"}" · domain ${rtsIdentity.domain || "(none)"}\n` +
          `Researched company: "${json.companyName || "(none)"}" · domain ${json.domain || "(none)"}\n\n` +
          "Only proceed if you have personally verified these are the same company. Publish anyway?"
        );
        if (!confirmed) {
          setStatus(publishStatus, "Publish cancelled: identity could not be auto-confirmed, and you chose not to proceed manually.", "error");
          publishButton.disabled = false;
          clearCacheButton.disabled = false;
          return;
        }
      }

      let applied = 0, skipped = 0, failed = 0;
      const valueFor = (a) => rowsByActionId.get(a.actionId).getEditedValue();

      // Re-runs the real schema validator against a manually edited value
      // (wrapped back into a minimal envelope/array under its real
      // jsonPath) before it's ever handed to a workflow. This is what
      // actually makes a manual correction safe: a typo that breaks the
      // schema (e.g. an invalid Name Type, a malformed source URL) is
      // caught here with the same error text the initial paste would have
      // gotten, instead of reaching a live DOM write.
      function revalidateEditedValue(action, editedValue) {
        const [topKey, subKey] = action.jsonPath.split(".");
        const wrapped = {
          schemaVersion: "1.0",
          profileIdentity: lastValidated.profileIdentity,
          [topKey]: { [subKey]: action.recordIndex !== null ? [editedValue] : editedValue }
        };
        try {
          globalThis.SXRTS.schema.validate(JSON.stringify(wrapped));
          return null;
        } catch (error) {
          return error instanceof globalThis.SXRTS.schema.SchemaValidationError ? error.errors.join(" ") : String(error);
        }
      }

      // Returns the edited value once it's confirmed schema-valid, or
      // marks the row "failed" with the validator's own message and
      // returns undefined so the caller skips calling the workflow.
      function validatedValueFor(entry) {
        const value = valueFor(entry.action);
        const error = revalidateEditedValue(entry.action, value);
        if (error) {
          failed++;
          setRowStatus(entry.action.actionId, "failed", error);
          return undefined;
        }
        return value;
      }

      const nameVariationActions = selected.filter((entry) => entry.action.jsonPath === "businessEntity.nameVariations");
      for (const entry of nameVariationActions) {
        const value = validatedValueFor(entry);
        if (value === undefined) continue;
        try {
          const result = await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation(value);
          if (result.status === "savedValueVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", ""); }
          else { skipped++; setRowStatus(entry.action.actionId, "skipped", result.detail || result.reason); }
        } catch (error) {
          failed++; setRowStatus(entry.action.actionId, "failed", error.message);
        }
      }

      const generalJsonPaths = ["businessEntity.websiteAddresses", "businessEntity.emailDefaultStructure", "businessEntity.researchNotes"];
      const generalEntries = selected.filter((entry) => generalJsonPaths.includes(entry.action.jsonPath));
      if (generalEntries.length) {
        const fields = {};
        const validEntries = [];
        for (const entry of generalEntries) {
          const value = validatedValueFor(entry);
          if (value === undefined) continue;
          validEntries.push(entry);
          if (entry.action.jsonPath === "businessEntity.websiteAddresses") {
            (fields.websiteAddresses ??= []).push(value);
          } else if (entry.action.jsonPath === "businessEntity.emailDefaultStructure") {
            fields.emailDefaultStructure = value;
          } else if (entry.action.jsonPath === "businessEntity.researchNotes") {
            (fields.researchNotes ??= []).push(value);
          }
        }

        if (validEntries.length) {
          try {
            const groupResult = await globalThis.SXRTS.workflows.businessEntityGeneral.applyBusinessEntityGeneral(fields);
            const fieldKeyByJsonPath = {
              "businessEntity.websiteAddresses": "websiteAddresses",
              "businessEntity.emailDefaultStructure": "emailDefaultStructure",
              "businessEntity.researchNotes": "researchNotes"
            };
            for (const entry of validEntries) {
              const fieldResult = groupResult.results?.[fieldKeyByJsonPath[entry.action.jsonPath]];
              const status = fieldResult?.status ?? groupResult.status;
              const reason = fieldResult?.reason ?? groupResult.reason ?? "";
              setRowStatus(entry.action.actionId, status, reason);
              if (status === "savedValueVerified") applied++; else if (status === "skipped") skipped++; else failed++;
            }
          } catch (error) {
            failed += validEntries.length;
            for (const entry of validEntries) setRowStatus(entry.action.actionId, "failed", error.message);
          }
        }
      }

      const sicEntries = selected.filter((entry) => entry.action.jsonPath === "company.sicCodes");
      for (const entry of sicEntries) {
        const value = validatedValueFor(entry);
        if (value === undefined) continue;
        try {
          const result = await globalThis.SXRTS.workflows.companySic.applySicCode(value);
          if (result.status === "savedValueVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", ""); }
          else { skipped++; setRowStatus(entry.action.actionId, "skipped", result.detail || result.reason); }
        } catch (error) {
          failed++; setRowStatus(entry.action.actionId, "failed", error.message);
        }
      }

      const warningText = identityResult.reasons.length ? `\nIdentity warnings:\n${identityResult.reasons.join("\n")}` : "";
      setStatus(publishStatus, `Published ${applied}, skipped ${skipped}, failed ${failed}.${warningText}`, failed ? "error" : "success");
      publishButton.disabled = false;
      clearCacheButton.disabled = false;
      persistToCache();
    });

    closeButton.addEventListener("click", () => document.getElementById("sxrts-assistant-root")?.remove());

    panel.appendChild(body);
    shadow.appendChild(panel);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.panel = { mount };
})();
