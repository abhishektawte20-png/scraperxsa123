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
    if (options.tip) node.setAttribute("data-tip", options.tip);
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
        --navy: #0b2f52; --blue: #124a80; --blue-soft: #eaf2fb; --ink: #1b2430; --muted: #6b778c; --line: #e3e8ef;
        --ok: #166f4c; --ok-soft: #e7f6ef; --warn: #8a5a00; --warn-soft: #fff6e0; --bad: #a3291c; --bad-soft: #fdeeec;
        position: fixed; z-index: 2147483647; right: 18px; top: 18px;
        width: min(620px, calc(100vw - 36px)); max-height: calc(100vh - 36px); overflow: auto;
        background: #f5f7fa; color: var(--ink); border: 1px solid #d8dfe9; border-radius: 16px;
        box-shadow: 0 24px 60px rgba(11, 30, 60, .28), 0 2px 10px rgba(11, 30, 60, .10);
        font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        scrollbar-width: thin;
      }
      .head {
        position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px;
        padding: 14px 16px 14px 18px; color: #fff; border-radius: 15px 15px 0 0;
        background: radial-gradient(120% 160% at 0% 0%, #1b6aa8 0%, #124a80 45%, #0b2f52 100%);
        box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 6px 16px rgba(11,30,60,.18);
      }
      .brand { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
      .brand-mark {
        width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(145deg, rgba(255,255,255,.28), rgba(255,255,255,.08)); border: 1px solid rgba(255,255,255,.28);
        font-weight: 800; font-size: 15px; letter-spacing: -.5px; box-shadow: 0 2px 8px rgba(0,0,0,.18);
      }
      .brand-text h1 { margin: 0; font-size: 17px; font-weight: 750; letter-spacing: .1px; line-height: 1.15; }
      .brand-text .sub { margin: 1px 0 0; font-size: 11.5px; color: rgba(255,255,255,.80); }
      .brand-text .by { margin: 1px 0 0; font-size: 10.5px; color: rgba(255,255,255,.62); letter-spacing: .2px; }
      .ver { font-size: 10px; font-weight: 650; padding: 2px 8px; border-radius: 100px; background: rgba(255,255,255,.16); color: #fff; }
      .close {
        width: 30px; height: 30px; border: 0; border-radius: 8px; background: rgba(255,255,255,.14);
        color: #fff; font-size: 19px; line-height: 1; cursor: pointer; flex-shrink: 0; transition: background .12s;
      }
      .close:hover { background: rgba(255,255,255,.28); }

      .steps { display: flex; gap: 6px; padding: 14px 18px 4px; }
      .step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; color: #8993a4; font-size: 10.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .3px; text-align: center; position: relative; }
      .step::before { content: attr(data-n); width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: #fff; border: 2px solid #d3dbe7; color: #8993a4; font-size: 11px; font-weight: 750; z-index: 1; }
      .step::after { content: ""; position: absolute; top: 11px; left: calc(50% + 14px); right: calc(-50% + 14px); height: 2px; background: #d3dbe7; }
      .step:last-child::after { display: none; }
      .step.active { color: var(--blue); }
      .step.active::before { border-color: var(--blue); color: var(--blue); box-shadow: 0 0 0 4px rgba(18,74,128,.12); }
      .step.done { color: var(--ok); }
      .step.done::before { content: "✓"; background: var(--ok); border-color: var(--ok); color: #fff; }
      .step.done::after { background: var(--ok); }

      .body { padding: 12px 18px 6px; }
      .card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 0 14px; background: #fff; box-shadow: 0 1px 2px rgba(20,40,70,.04); }
      .card h2 { margin: 0 0 12px; font-size: 11.5px; font-weight: 750; text-transform: uppercase; letter-spacing: .5px; color: var(--blue); display: flex; align-items: center; gap: 4px; }
      .notice { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid #f0dcaa; background: var(--warn-soft); color: var(--warn); font-size: 12px; }
      .cache-notice { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid #cfe0f3; background: var(--blue-soft); color: var(--navy); font-size: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .cache-notice .spacer { flex: 1; }

      .field { margin: 0 0 12px; }
      .field:last-child { margin-bottom: 0; }
      label { display: block; margin: 0 0 5px; font-weight: 650; font-size: 12px; color: #33405a; }
      input[type="text"], input:not([type]), textarea, select {
        width: 100%; border: 1px solid #cdd5e1; border-radius: 8px; padding: 8px 10px; font: inherit; background: #fff; color: var(--ink); transition: border-color .12s, box-shadow .12s;
      }
      input:focus, textarea:focus, select:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px rgba(18,74,128,.16); }
      textarea { min-height: 96px; resize: vertical; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; }
      #sxrts-response { min-height: 130px; }
      #sxrts-prompt { min-height: 150px; background: #f8fafc; }

      .row { display: flex; gap: 10px; }
      .row > * { flex: 1; }

      .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      button.btn { border: 1px solid var(--blue); border-radius: 8px; padding: 8px 14px; background: var(--blue); color: #fff; font: 650 12.5px/1.2 inherit; cursor: pointer; transition: background .12s, box-shadow .12s, transform .05s; }
      button.btn:hover:not(:disabled) { background: #0d3a66; box-shadow: 0 2px 8px rgba(18,74,128,.28); }
      button.btn:active:not(:disabled) { transform: translateY(1px); }
      button.btn.secondary { background: #fff; color: var(--blue); }
      button.btn.secondary:hover:not(:disabled) { background: var(--blue-soft); box-shadow: none; }
      button.btn.danger { background: #fff; color: var(--bad); border-color: #e3bcb6; }
      button.btn.danger:hover:not(:disabled) { background: var(--bad-soft); box-shadow: none; }
      button.btn.primary-cta { background: linear-gradient(180deg, #1f9d6d, #178a5d); border-color: #178a5d; padding: 10px 20px; font-size: 13px; }
      button.btn.primary-cta:hover:not(:disabled) { background: #146f4c; }
      button.btn.map { padding: 5px 10px; font-size: 11.5px; background: #fff; color: #7a4a00; border-color: #e6c27a; }
      button.btn.map:hover:not(:disabled) { background: var(--warn-soft); box-shadow: none; }
      button.btn:disabled { opacity: .45; cursor: not-allowed; }

      .status { min-height: 18px; margin: 8px 0 0; color: #47536b; white-space: pre-wrap; font-size: 12px; }
      .status.error { color: var(--bad); }
      .status.success { color: var(--ok); }
      .status.warn { color: var(--warn); }
      .verdict { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; font-weight: 650; font-size: 12.5px; }
      .verdict.ok { background: var(--ok-soft); color: var(--ok); }
      .verdict.bad { background: var(--bad-soft); color: var(--bad); }
      .verdict .count { margin-left: auto; font-weight: 600; font-size: 11.5px; opacity: .85; }
      .issues { display: grid; gap: 6px; margin-top: 8px; }
      .issue { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.45; white-space: normal; }
      .issue.err { background: var(--bad-soft); color: #7e1f15; }
      .issue.warn { background: var(--warn-soft); color: #6b4700; }
      .issue.info { background: var(--blue-soft); color: var(--navy); }
      .issue .chip { font: 700 10px/1.5 ui-monospace, "SF Mono", Menlo, monospace; padding: 1px 6px; border-radius: 5px; background: rgba(0,0,0,.08); white-space: nowrap; }
      .issue .path { font-weight: 650; }

      .group-title { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; font-size: 11.5px; font-weight: 750; text-transform: uppercase; letter-spacing: .4px; color: #47536b; }
      .group-title:first-child { margin-top: 2px; }
      .group-title .n { padding: 1px 8px; border-radius: 100px; background: #e7ecf3; font-size: 10.5px; }
      .group-title.ready .n { background: var(--ok-soft); color: var(--ok); }
      .group-title.waiting .n { background: var(--warn-soft); color: var(--warn); }
      .group-note { font-size: 11.5px; color: var(--muted); margin: -2px 0 8px; }
      .action-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
      .action-card { border: 1px solid var(--line); border-radius: 10px; padding: 11px 13px; background: #fff; transition: box-shadow .12s; }
      .action-card:hover { box-shadow: 0 2px 8px rgba(20,40,70,.08); }
      .action-card-skipped { background: #fbfaf6; border-style: dashed; border-color: #e5d9bd; }
      .action-card-head { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 8px; }
      .action-card-head input[type="checkbox"] { margin-top: 3px; flex-shrink: 0; width: auto; accent-color: var(--blue); }
      .action-card-title { flex: 1; min-width: 0; }
      .action-card-field { font-weight: 700; font-size: 12.5px; color: var(--ink); overflow-wrap: anywhere; }
      .action-card-area { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .3px; margin-top: 1px; }
      .value-fields { display: flex; flex-direction: column; gap: 6px; padding-left: 26px; }
      .value-field { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: start; }
      .value-field-label { font-size: 10.5px; font-weight: 650; color: var(--muted); text-transform: uppercase; letter-spacing: .2px; padding-top: 8px; }
      .value-field input, .value-field textarea { font-size: 12px; }
      .action-card-skipped .value-field.meta { display: none; }
      .action-card-skipped .value-field input, .action-card-skipped .value-field textarea, .action-card-skipped .value-field select { background: #faf8f2; color: #55607a; }
      .action-reason { padding-left: 26px; margin-top: 7px; font-size: 11.5px; color: #8a5a00; }
      .map-row { padding-left: 26px; margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .map-row .why { font-size: 11px; color: var(--muted); }
      .badge { display: inline-block; padding: 3px 9px; border-radius: 100px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .25px; flex-shrink: 0; }
      .badge-pending { background: var(--blue-soft); color: var(--blue); }
      .badge-skipped { background: #eef0f4; color: var(--muted); }
      .badge-waiting { background: var(--warn-soft); color: var(--warn); }
      .badge-saved { background: var(--ok-soft); color: var(--ok); }
      .badge-failed { background: var(--bad-soft); color: var(--bad); }
      .hidden { display: none !important; }
      .helptext { font-size: 11.5px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
      details.more { margin: 0 0 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 8px 12px; }
      details.more summary { cursor: pointer; font-weight: 650; font-size: 12px; color: #33405a; }

      .foot { text-align: center; padding: 6px 18px 18px; font-size: 11px; color: var(--muted); }
      .foot strong { color: var(--navy); font-weight: 700; }

      .summary-header { margin-bottom: 14px; }
      .summary-header h3 { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: var(--ink); }
      .summary-stats { display: flex; gap: 12px; flex-wrap: wrap; font-weight: 650; }
      .stat-item { display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 650; }
      .stat-item.success { background: var(--ok-soft); color: var(--ok); }
      .stat-item.error { background: var(--bad-soft); color: var(--bad); }
      .stat-item.skipped { background: #eef0f4; color: var(--muted); }
      .summary-item { margin-bottom: 10px; padding: 10px; border-radius: 8px; border-left: 3px solid var(--line); background: #fbfcfe; }
      .summary-item-success { border-left-color: #1a8a5f; background: #f0faf7; }
      .summary-item-skipped { border-left-color: #9ca3af; background: #f5f5f7; opacity: .85; }
      .summary-item-error { border-left-color: #dc2626; background: #fef2f2; }
      .summary-item-header { display: flex; gap: 10px; align-items: flex-start; }
      .summary-icon { font-size: 16px; font-weight: 700; flex-shrink: 0; width: 20px; text-align: center; }
      .summary-item-text { flex: 1; min-width: 0; }
      .summary-field { font-size: 12px; font-weight: 700; color: var(--ink); }
      .summary-message { font-size: 12px; color: #47536b; margin-top: 2px; }
      .summary-detail { font-size: 11px; color: #6b5100; background: var(--warn-soft); padding: 8px; border-radius: 6px; margin-top: 8px; }
      .summary-warning { white-space: pre-wrap; color: #6b5100; margin-top: 12px; padding-top: 12px; border-top: 1px solid #ffd9a8; font-size: 11px; }

      .html-capture-modal { display: none; position: fixed; z-index: 2147483648; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, .5); }
      .html-capture-modal.open { display: flex; align-items: center; justify-content: center; }
      .html-capture-content { background: #fff; border-radius: 14px; width: 90vw; max-width: 900px; max-height: 90vh; overflow: auto; padding: 24px; box-shadow: 0 20px 48px rgba(15, 30, 60, .22); }
      .html-capture-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
      .html-capture-header h2 { margin: 0; font-size: 16px; color: var(--ink); }
      .html-capture-close { background: none; border: 0; font-size: 24px; color: var(--muted); cursor: pointer; padding: 0; width: 24px; height: 24px; }
      .html-capture-close:hover { color: var(--ink); }
      .html-capture-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
      .html-capture-section:last-child { border-bottom: none; }
      .html-capture-field-name { font-weight: 700; font-size: 12px; color: var(--blue); text-transform: uppercase; margin-bottom: 8px; letter-spacing: .3px; }
      .html-capture-code { background: #f5f5f7; border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: var(--ink); max-height: 200px; }
      .html-capture-value { color: var(--ok); font-weight: 600; }
      .html-capture-buttons { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
      .html-capture-copy-btn { background: var(--blue); color: #fff; border: 1px solid var(--blue); border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
      ${globalThis.SXRTS.ui?.TIP_CSS ?? ""}
    `;
    shadow.appendChild(style);
    globalThis.SXRTS.ui?.installTips(shadow);
    const tipText = (node, text) => { node.setAttribute("data-tip", text); return node; };

    // ---------- Header ----------
    const panel = element("div", { className: "panel" });
    const closeButton = element("button", { className: "close", text: "×", type: "button", title: "Close" });
    panel.appendChild(element("div", { className: "head" }, [
      element("div", { className: "brand" }, [
        element("div", { className: "brand-mark", text: "SX" }),
        element("div", { className: "brand-text" }, [
          element("h1", { text: "ScraperX" }),
          element("p", { className: "sub", text: "RTS Profile Assistant" }),
          element("p", { className: "by", text: globalThis.SXRTS.ui?.CREDIT ?? "Developed by Abhishek Tawte" })
        ])
      ]),
      ...(globalThis.SXRTS.ui?.version() ? [element("span", { className: "ver", text: `v${globalThis.SXRTS.ui.version()}` })] : []),
      closeButton
    ]));

    const stepBar = element("div", { className: "steps" });
    const steps = ["Identify", "Research", "Validate", "Preview & publish"];
    const stepEls = steps.map((label, i) => { const node = element("div", { className: "step", text: label }); node.dataset.n = String(i + 1); return node; });
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
    body.appendChild(element("p", { className: "notice", text: "Live end to end: Name Variations, Website Address, Email Default Structure, Research Notes and SIC codes. Any other field can be switched on in seconds: click \"Map this field\" on its row in the preview and point at the field in RTS." }));

    const cacheNotice = element("div", { className: "cache-notice hidden" });
    body.appendChild(cacheNotice);
    const restoreNotice = element("div", { className: "cache-notice hidden" });
    body.appendChild(restoreNotice);

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
    promptLabel.appendChild(globalThis.SXRTS.ui?.help("Send this to your ScraperX agent. It starts with the domain, then gives the exact JSON output format this tool validates.") ?? document.createTextNode(""));
    const promptArea = element("textarea", { id: "sxrts-prompt" });
    promptArea.readOnly = true;
    identityCard.appendChild(element("div", { className: "field" }, [promptLabel, promptArea]));

    // The per-run message is just the target domain: the Rovo agent's own
    // configuration owns the methodology and the output contract, and
    // nothing sent from here may override either.
    function regeneratePrompt() {
      promptArea.value = globalThis.SXRTS.promptBuilder.buildRunPrompt({ domain: domainInput.value });
    }
    regeneratePrompt();
    companyNameInput.addEventListener("input", regeneratePrompt);
    domainInput.addEventListener("input", regeneratePrompt);

    // Taught fields feed the prompt, so it is rebuilt once they load and
    // whenever one is added or removed.
    globalThis.SXRTS.customFields?.load().then(regeneratePrompt);
    // Re-run validation after a mapping or rule changes so the preview updates by itself.
    const revalidate = () => { if (lastValidated && textarea.value.trim()) validateButton.click(); };
    const teach = globalThis.SXRTS.teach?.mount(shadow, {
      onChange: () => { regeneratePrompt(); revalidate(); },
      onMapped: (label) => setStatus(publishStatus, `Mapped "${label}". It is now in "Ready to publish" below.`, "success")
    });
    const teachButton = element("button", { className: "btn secondary", text: "Teach new field", type: "button", tip: "Teach the extension a brand-new RTS field, or review and delete your mappings. To fill a field the agent already researched, use \"Map this field\" on its row in the preview." });
    teachButton.addEventListener("click", () => teach?.open());

    // Saved output rules (e.g. "Facebook: keep only the handle") are applied
    // when the output is validated; changing a rule re-validates what is pasted.
    globalThis.SXRTS.outputRules?.load();
    const rulesUi = globalThis.SXRTS.rulesUi?.mount(shadow, {
      onChange: revalidate,
      getSample: (target) => {
        const applied = lastValidated?.rulesApplied?.find((r) => r.target === target);
        return applied?.before ?? globalThis.SXRTS.outputRules.refsFor(lastValidated, target)[0]?.get() ?? null;
      }
    });
    const rulesButton = element("button", { className: "btn secondary", text: "Output rules", type: "button", tip: "Saved changes applied to the agent's output before it reaches RTS. Example: keep only the Facebook handle instead of the whole URL." });
    rulesButton.addEventListener("click", () => rulesUi?.open());

    const copyPromptButton = element("button", { className: "btn", text: "Copy prompt", type: "button", tip: "Copies the complete prompt for this domain: the domain on the first line, then the exact JSON output format the extension validates. Paste it into your ScraperX agent and run it." });
    const openRovoButton = element("button", { className: "btn secondary", text: "Open Rovo", type: "button", tip: "Opens Rovo in a new tab." });
    identityCard.appendChild(element("div", { className: "buttons" }, [copyPromptButton, openRovoButton, teachButton, rulesButton]));
    identityCard.appendChild(element("p", { className: "helptext", text: "The prompt starts with the domain, then gives the agent the exact JSON format this tool validates. It never changes your methodology, only how the finished result is written." }));
    body.appendChild(identityCard);

    // ---------- Card 2: paste + validate ----------
    const jsonCard = element("div", { className: "card" });
    jsonCard.appendChild(element("h2", { text: "2-3 · Research in Rovo, then paste the result" }));
    const responseLabel = element("label", { text: "Paste the ScraperX agent output (text report or JSON)" });
    responseLabel.appendChild(globalThis.SXRTS.ui?.help("Paste the whole report. Echoed instructions or chat text before or after it are ignored automatically.") ?? document.createTextNode(""));
    const textarea = element("textarea", { id: "sxrts-response", placeholder: "Paste the agent output here: the whole report is fine, extra text before or after it is ignored. Nothing is read from your clipboard automatically." });
    jsonCard.appendChild(element("div", { className: "field" }, [responseLabel, textarea]));
    const validateButton = element("button", { className: "btn", text: "Validate JSON", type: "button", tip: "Checks the pasted report against the output rules and builds the preview. Nothing is written to RTS yet." });
    const copyFixButton = element("button", { className: "btn secondary hidden", text: "Copy correction prompt", type: "button", tip: "Copies a message for the agent that lists exactly which rules were broken and how to fix each." });
    jsonCard.appendChild(element("div", { className: "buttons" }, [validateButton, copyFixButton]));
    const validateStatus = element("div", { className: "status" });
    jsonCard.appendChild(validateStatus);
    body.appendChild(jsonCard);

    // ---------- Card 3: preview + publish ----------
    const previewCard = element("div", { className: "card hidden" });
    previewCard.appendChild(element("h2", { text: "4 · Preview, edit if needed, then publish" }));
    previewCard.appendChild(element("p", { className: "helptext", text: "Uncheck anything you don't want applied. Edit a field directly if only a small correction is needed — it's re-validated when you publish." }));
    const rovoRows = element("details", { className: "more hidden" });
    previewCard.appendChild(rovoRows);
    const actionList = element("div", { className: "action-list" });
    previewCard.appendChild(actionList);
    const selectAllButton = element("button", { className: "btn secondary", text: "Select all pending", type: "button", tip: "Ticks every row that is ready to publish." });
    const publishButton = element("button", { className: "btn primary-cta", text: "Publish selected to RTS", type: "button", tip: "Fills the ticked rows in the open RTS profile, clicks Save, then reads each value back to confirm it saved. The identity lock checks this is the right profile first." });
    const captureHtmlButton = element("button", { className: "btn secondary", text: "Capture field HTML", type: "button", tip: "Shows the real HTML of the form fields on this page so you can check they were populated." });
    const clearCacheButton = element("button", { className: "btn danger", text: "Clear cache for this profile", type: "button", tip: "Forgets the saved plan and the last pasted report for this profile." });
    previewCard.appendChild(element("div", { className: "buttons" }, [selectAllButton, publishButton, captureHtmlButton, clearCacheButton]));
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

    // The last validated JSON is remembered per profile (keyed by the open
    // RTS profile's identity when it can be read) so it can be restored
    // without pasting it again.
    function lastJsonIdentity() {
      try {
        return globalThis.SXRTS.identityLock.readRtsIdentityFromPage();
      } catch {
        return lastValidated?.profileIdentity ?? null;
      }
    }

    async function offerRestoreLastJson() {
      try {
        const saved = await globalThis.SXRTS.cache.getLastJson(lastJsonIdentity());
        if (!saved?.text) return;
        const restoreButton = element("button", { className: "btn secondary", text: "Restore last pasted JSON", type: "button" });
        restoreButton.addEventListener("click", () => {
          textarea.value = saved.text;
          restoreNotice.classList.add("hidden");
          setStatus(validateStatus, "Restored. Click Validate JSON to rebuild the preview.", "success");
        });
        restoreNotice.replaceChildren(
          element("span", { text: `Last pasted JSON for this profile saved ${formatTimestamp(saved.savedAt)}.` }),
          element("span", { className: "spacer" }),
          restoreButton
        );
        restoreNotice.classList.remove("hidden");
      } catch {
        // No readable profile identity yet, or storage unavailable: nothing to restore.
      }
    }
    offerRestoreLastJson();

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
      if (jsonPath.startsWith("custom.") || globalThis.SXRTS.customFields?.getBoundDef(jsonPath)) {
        return globalThis.SXRTS.customFields?.optionsFor(jsonPath, key) ?? null;
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
        const fieldRow = element("div", { className: `value-field${key === "action" || key === "confidence" ? " meta" : ""}` });
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
          if (!matched && currentText) {
            // Never swap an unsupported value for another one behind the
            // researcher's back: keep it visible so validation rejects it.
            input.appendChild(element("option", { value: currentText, text: `${currentText} (not an available option)` }));
            input.value = currentText;
          } else {
            input.value = matched || (options.allowBlank ? "" : options.values[0]);
          }
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

      const waitingForEvidence = !isRunnable && /registry entry|evidence for this field/i.test(action.skipReason || "");
      const statusBadge = element("span", { className: `badge badge-${isRunnable ? "pending" : waitingForEvidence ? "waiting" : "skipped"}`, text: waitingForEvidence ? "waiting for RTS evidence" : action.executionStatus });
      const reasonEl = element("div", { className: "action-reason", text: action.skipReason || "" });

      const head = element("div", { className: "action-card-head" }, [
        checkbox,
        element("div", { className: "action-card-title" }, [
          element("div", { className: "action-card-field", text: `${action.jsonPath}${action.recordIndex !== null ? `[${action.recordIndex}]` : ""}` }),
          element("div", { className: "action-card-area", text: (() => { const cat = globalThis.SXRTS.outputFields?.get(action.jsonPath); return cat ? `${action.area || cat.area} · ${cat.label}` : (action.area || "(unregistered)"); })() })
        ]),
        statusBadge
      ]);

      const prefix = action.recordIndex !== null ? `${action.jsonPath}[${action.recordIndex}]` : action.jsonPath;
      const ruleNotes = (lastValidated?.rulesApplied ?? []).filter((r) => r.path.startsWith(prefix))
        .map((r) => element("div", { className: "action-reason", text: `Output rule "${r.rule}" changed this value: ${r.before} → ${r.after}` }));
      const mappable = waitingForEvidence && globalThis.SXRTS.outputFields?.get(action.jsonPath);
      const mapRow = [];
      if (mappable) {
        const mapButton = element("button", { className: "btn map", text: "Map this field", type: "button", tip: `Teach the extension where "${mappable.label}" goes in RTS. You open the field in RTS and click it (about 30 seconds). After that it is filled for every company.` });
        mapButton.addEventListener("click", () => {
          const samples = globalThis.SXRTS.outputFields.recordsFor(lastValidated, action.jsonPath);
          teach?.open({ bindPath: action.jsonPath, samples });
        });
        mapRow.push(element("div", { className: "map-row" }, [mapButton, element("span", { className: "why", text: "Not filled yet: the extension doesn't know where this goes in RTS." })]));
      }
      const card = element("div", { className: `action-card${isRunnable ? "" : " action-card-skipped"}` }, [head, editor.element, ...ruleNotes, ...mapRow, reasonEl]);

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
      entry.card.querySelector(".map-row")?.remove();
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
      const ready = lastActions.filter((a) => a.executionStatus === "pending");
      const waiting = lastActions.filter((a) => a.executionStatus !== "pending");
      const groupTitle = (cls, text, n) => element("div", { className: `group-title ${cls}` }, [element("span", { text }), element("span", { className: "n", text: String(n) })]);
      if (ready.length) {
        actionList.appendChild(groupTitle("ready", "Ready to publish", ready.length));
        for (const action of ready) actionList.appendChild(renderActionRow(action));
      }
      if (waiting.length) {
        actionList.appendChild(groupTitle("waiting", "Waiting for RTS mapping", waiting.length));
        actionList.appendChild(element("div", { className: "group-note", text: "The agent found these, but the extension doesn't know where they go in RTS yet. Click \"Map this field\" on a row to fix that." }));
        for (const action of waiting) actionList.appendChild(renderActionRow(action));
      }
      previewCard.classList.remove("hidden");
      renderRovoRows(lastValidated.rovo?.rows);
      const skippedCount = lastActions.filter((a) => a.executionStatus === "skipped").length;
      const runnable = lastActions.length - skippedCount;
      setStatus(publishStatus, `${lastActions.length} proposed change(s): ${runnable} ready to publish, ${skippedCount} waiting for RTS mapping.`, "");
      publishButton.disabled = runnable === 0;
      setStep(3);
      persistToCache();
    }

    let lastIssues = [];
    let lastFormat = "json";

    // Structured validation result: a verdict banner, then one line per finding
    // (errors red, warnings amber, notes blue), each with its rule code.
    function renderValidation(ok, lines, headline) {
      validateStatus.className = `status ${ok ? "success" : "error"}`;
      validateStatus.replaceChildren();
      const errors = lines.filter((l) => l.kind === "err").length;
      const warnings = lines.filter((l) => l.kind === "warn").length;
      const counts = ok
        ? `${warnings} warning${warnings === 1 ? "" : "s"}`
        : `${errors} problem${errors === 1 ? "" : "s"} to fix`;
      validateStatus.appendChild(element("div", { className: `verdict ${ok ? "ok" : "bad"}` }, [
        element("span", { text: ok ? "✓" : "✕" }),
        element("span", { text: headline }),
        element("span", { className: "count", text: counts })
      ]));
      if (!lines.length) return;
      const list = element("div", { className: "issues" });
      for (const line of lines) {
        const match = line.text.match(/^\[(\w+)\]\s*(.*)$/);
        const body = match ? match[2] : line.text;
        const split = body.match(/^([A-Za-z_][\w.\[\]() -]*?):\s+(.*)$/);
        list.appendChild(element("div", { className: `issue ${line.kind}` }, [
          element("span", { className: "chip", text: match ? `[${match[1]}] ` : "• " }),
          element("span", {}, split
            ? [element("span", { className: "path", text: `${split[1]}: ` }), element("span", { text: split[2] })]
            : [element("span", { text: body })])
        ]));
      }
      validateStatus.appendChild(list);
    }
    const lineKind = (text) => (/^\[(NOISE_REMOVED|OUTPUT_RULE)\]/.test(text) ? "info" : "warn");
    copyFixButton.addEventListener("click", async () => {
      const text = globalThis.SXRTS.rovoContract.buildCorrectionPrompt(lastIssues, domainInput.value.trim(), lastFormat);
      try {
        await navigator.clipboard.writeText(text);
        setStatus(validateStatus, "Correction prompt copied. Send it to Rovo, then paste the corrected JSON here.", "success");
      } catch {
        textarea.value = text;
        setStatus(validateStatus, "Copy was blocked by the browser; the correction prompt was placed in the box above — select and copy it.", "error");
      }
    });

    // Rovo research that is not turned into an RTS action is still shown,
    // with an explicit automation status, rather than silently dropped.
    function renderRovoRows(rows) {
      rovoRows.replaceChildren();
      if (!rows?.length) { rovoRows.classList.add("hidden"); return; }
      rovoRows.appendChild(element("summary", { text: `Rovo research not applied automatically (${rows.length})` }));
      for (const row of rows) {
        rovoRows.appendChild(element("div", { className: "helptext", text: `${row.section}: ${row.value || "—"}  ·  RTS automation: ${row.status.replaceAll("_", " ").toLowerCase()}${row.status === "NO_VALUE" ? "" : ` — ${row.detail}`}` }));
      }
      rovoRows.classList.remove("hidden");
    }

    validateButton.addEventListener("click", () => {
      lastIssues = [];
      copyFixButton.classList.add("hidden");
      try {
        lastValidated = globalThis.SXRTS.schema.validate(textarea.value, { domain: domainInput.value });
        const customResult = globalThis.SXRTS.customFields?.validatePayload(lastValidated.custom);
        if (customResult) {
          if (customResult.errors.length) throw new globalThis.SXRTS.schema.SchemaValidationError(customResult.errors);
          lastValidated.custom = customResult.value;
          lastValidated.warnings.push(...customResult.warnings);
        }
        globalThis.SXRTS.cache.setLastJson(lastJsonIdentity(), textarea.value).catch(() => {});
        renderValidation(true, lastValidated.warnings.map((text) => ({ kind: lineKind(text), text })), "Valid — preview built below");
        setStep(2);
        buildPlan();
      } catch (error) {
        lastValidated = null;
        previewCard.classList.add("hidden");
        // A halt is Rovo's own decision, not a violation to "correct".
        if (error.issues?.some((item) => item.severity === "error" && item.code !== "HALTED")) {
          lastIssues = error.issues;
          lastFormat = error.format || "json";
          copyFixButton.classList.remove("hidden");
        }
        if (error instanceof globalThis.SXRTS.schema.SchemaValidationError) {
          const halted = error.errors.some((e) => /^\[HALTED\]/.test(e));
          // Show everything in one pass: the blocking errors first, then the
          // warnings, so a re-run is never needed just to discover the rest.
          const contract = globalThis.SXRTS.rovoContract;
          const extra = (error.issues ?? []).filter((item) => item.severity !== "error").map((item) => ({ kind: item.severity === "warning" ? "warn" : "info", text: contract.formatIssue(item) }));
          renderValidation(false, [...error.errors.map((text) => ({ kind: "err", text })), ...extra], halted ? "The agent halted this extraction" : "The output broke the rules below");
        } else {
          setStatus(validateStatus, String(error), "error");
        }
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
      const allResults = {};
      const valueFor = (a) => rowsByActionId.get(a.actionId).getEditedValue();

      // Re-runs the real schema validator against a manually edited value
      // (wrapped back into a minimal envelope/array under its real
      // jsonPath) before it's ever handed to a workflow. This is what
      // actually makes a manual correction safe: a typo that breaks the
      // schema (e.g. an invalid Name Type, a malformed source URL) is
      // caught here with the same error text the initial paste would have
      // gotten, instead of reaching a live DOM write.
      function revalidateEditedValue(action, editedValue) {
        const customDef = action.customKey ? globalThis.SXRTS.customFields?.getDefinition(action.customKey) : null;
        if (customDef) {
          const cf = globalThis.SXRTS.customFields;
          return cf.validateRecord(customDef, customDef.binds ? cf.toDefRecord(customDef, editedValue) : editedValue);
        }
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
          recordResult(entry.action.jsonPath, { status: "error", error });
          return undefined;
        }
        return value;
      }

      function recordResult(jsonPath, result) {
        if (!allResults[jsonPath]) allResults[jsonPath] = [];
        allResults[jsonPath].push(result);
      }

      const nameVariationActions = selected.filter((entry) => entry.action.jsonPath === "businessEntity.nameVariations");
      for (const entry of nameVariationActions) {
        const value = validatedValueFor(entry);
        if (value === undefined) continue;
        try {
          const result = await globalThis.SXRTS.workflows.businessEntityNameVariations.applyNameVariation(value);
          recordResult(entry.action.jsonPath, result);
          if (result.status === "savedValueVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", ""); }
          else { skipped++; setRowStatus(entry.action.actionId, "skipped", result.detail || result.reason); }
        } catch (error) {
          failed++; setRowStatus(entry.action.actionId, "failed", error.message);
          recordResult(entry.action.jsonPath, { status: "error", error: error.message });
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
              const result = { status, reason };
              recordResult(entry.action.jsonPath, result);
              setRowStatus(entry.action.actionId, status, reason);
              if (status === "savedValueVerified") applied++; else if (status === "skipped") skipped++; else failed++;
            }
          } catch (error) {
            failed += validEntries.length;
            for (const entry of validEntries) {
              setRowStatus(entry.action.actionId, "failed", error.message);
              recordResult(entry.action.jsonPath, { status: "error", error: error.message });
            }
          }
        }
      }

      const sicEntries = selected.filter((entry) => entry.action.jsonPath === "company.sicCodes");
      for (const entry of sicEntries) {
        const value = validatedValueFor(entry);
        if (value === undefined) continue;
        try {
          const result = await globalThis.SXRTS.workflows.companySic.applySicCode(value);
          recordResult(entry.action.jsonPath, result);
          if (result.status === "savedValueVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", ""); }
          else { skipped++; setRowStatus(entry.action.actionId, "skipped", result.detail || result.reason); }
        } catch (error) {
          failed++; setRowStatus(entry.action.actionId, "failed", error.message);
          recordResult(entry.action.jsonPath, { status: "error", error: error.message });
        }
      }

      const customEntries = selected.filter((entry) => entry.action.customKey);
      for (const entry of customEntries) {
        const value = validatedValueFor(entry);
        if (value === undefined) continue;
        const def = globalThis.SXRTS.customFields?.getDefinition(entry.action.customKey);
        if (!def) {
          failed++; setRowStatus(entry.action.actionId, "failed", "This taught field no longer exists.");
          recordResult(entry.action.jsonPath, { status: "error", error: "This taught field no longer exists." });
          continue;
        }
        try {
          const result = await globalThis.SXRTS.workflows.customField.applyCustomField(def, globalThis.SXRTS.customFields.normalizeRecord(def, def.binds ? globalThis.SXRTS.customFields.toDefRecord(def, value) : value));
          recordResult(entry.action.jsonPath, result);
          if (result.status === "savedValueVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", ""); }
          else if (result.status === "savedStateVerified") { applied++; setRowStatus(entry.action.actionId, "savedValueVerified", result.detail); }
          else { skipped++; setRowStatus(entry.action.actionId, "skipped", result.detail || result.reason); }
        } catch (error) {
          failed++; setRowStatus(entry.action.actionId, "failed", error.message);
          recordResult(entry.action.jsonPath, { status: "error", error: error.message });
        }
      }

      const summary = globalThis.SXRTS.resultsSummary.buildSummary(allResults);
      const warningText = identityResult.reasons.length ? `\nIdentity warnings:\n${identityResult.reasons.join("\n")}` : "";

      const summaryDiv = document.createElement("div");
      summaryDiv.innerHTML = summary.html;
      publishStatus.textContent = "";
      publishStatus.appendChild(summaryDiv);
      publishStatus.className = `status ${failed ? "error" : "success"}`;
      if (warningText) {
        const warningDiv = document.createElement("div");
        warningDiv.className = "summary-warning";
        warningDiv.textContent = warningText;
        publishStatus.appendChild(warningDiv);
      }

      publishButton.disabled = false;
      clearCacheButton.disabled = false;
      persistToCache();
    });

    closeButton.addEventListener("click", () => document.getElementById("sxrts-assistant-root")?.remove());

    // HTML Capture Modal
    const htmlCaptureModal = element("div", { className: "html-capture-modal", id: "sxrts-html-capture-modal" });
    const modalCloseButton = element("button", { className: "html-capture-close", text: "×", type: "button", title: "Close" });
    const captureContent = element("div", { className: "html-capture-content" });
    captureContent.appendChild(element("div", { className: "html-capture-header" }, [
      element("h2", { text: "Captured Field HTML" }),
      modalCloseButton
    ]));
    const captureBody = element("div", { id: "sxrts-capture-body" });
    captureContent.appendChild(captureBody);
    htmlCaptureModal.appendChild(captureContent);
    shadow.appendChild(htmlCaptureModal);

    modalCloseButton.addEventListener("click", () => {
      htmlCaptureModal.classList.remove("open");
    });

    htmlCaptureModal.addEventListener("click", (e) => {
      if (e.target === htmlCaptureModal) {
        htmlCaptureModal.classList.remove("open");
      }
    });

    function captureFieldsHtml() {
      const fieldSelectors = [
        { name: "Name Variations", selector: ".businessEntityName" },
        { name: "Website Address", selector: "#webURL" },
        { name: "Email Default Structure", selector: 'select[name="businessEntity.emailDefaultStructure.id"]' },
        { name: "Research Notes", selector: ".highlight-textarea" },
        { name: "SIC Codes", selector: 'input.numberField[name="code"]' },
        { name: "SIC Sources", selector: 'select[name="source"]' }
      ];

      const captureBody = shadow.getElementById("sxrts-capture-body");
      captureBody.replaceChildren();

      for (const { name, selector } of fieldSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;

        const section = element("div", { className: "html-capture-section" });
        section.appendChild(element("div", { className: "html-capture-field-name", text: name }));

        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const codeBlock = element("div", { className: "html-capture-code" });

          let displayValue = "";
          if (el.tagName === "INPUT") {
            displayValue = `value="${el.value}" (type: ${el.type})`;
          } else if (el.tagName === "SELECT") {
            displayValue = `value="${el.value}" (selected: ${el.selectedOptions[0]?.textContent || "none"})`;
          } else if (el.tagName === "TEXTAREA") {
            displayValue = `text: "${el.value.substring(0, 100)}${el.value.length > 100 ? "..." : ""}"`;
          } else {
            displayValue = `text: "${el.textContent.substring(0, 100)}${el.textContent.length > 100 ? "..." : ""}"`;
          }

          const html = document.createElement("div");
          html.innerHTML = `<strong>${el.tagName.toLowerCase()}</strong> ${displayValue}<br><code>${escapeHtml(el.outerHTML.substring(0, 300))}${el.outerHTML.length > 300 ? "..." : ""}</code>`;
          codeBlock.appendChild(html);
          section.appendChild(codeBlock);

          if (i < elements.length - 1) {
            section.appendChild(element("div", { className: "html-capture-code", style: { marginTop: "8px" } }));
          }
        }

        const copyBtn = element("button", { className: "html-capture-copy-btn", text: `Copy all ${name} HTML`, type: "button" });
        copyBtn.addEventListener("click", () => {
          const htmlSnippets = Array.from(document.querySelectorAll(selector)).map((el) => el.outerHTML).join("\n\n");
          navigator.clipboard.writeText(htmlSnippets).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = `Copy all ${name} HTML`; }, 2000);
          }).catch(() => {
            copyBtn.textContent = "Copy failed";
          });
        });
        section.appendChild(element("div", { className: "html-capture-buttons" }, [copyBtn]));

        captureBody.appendChild(section);
      }

      htmlCaptureModal.classList.add("open");
    }

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    captureHtmlButton.addEventListener("click", captureFieldsHtml);

    panel.appendChild(body);
    const credit = globalThis.SXRTS.ui?.CREDIT ?? "Developed by Abhishek Tawte";
    const creditName = credit.replace(/^Developed by\s+/i, "");
    panel.appendChild(element("div", { className: "foot" }, [
      element("strong", { text: "ScraperX" }),
      element("span", { text: ` RTS Profile Assistant  ·  Developed by ` }),
      element("strong", { text: creditName })
    ]));
    shadow.appendChild(panel);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.panel = { mount };
})();
