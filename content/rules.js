"use strict";

/*
 * "Output rules" dialog: define, test and delete the saved text changes that
 * are applied to the agent's output before it reaches the preview/RTS (see
 * core/outputRules.js). The live test box shows exactly what a rule will do.
 */
(() => {
  const CSS = `
    .rules-modal { display: none; position: fixed; z-index: 2147483648; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
    .rules-modal.open { display: flex; }
    .rules-card { background: #fff; border-radius: 14px; width: min(640px, 94vw); max-height: 90vh; overflow: auto; padding: 20px 22px; box-shadow: 0 20px 48px rgba(15,30,60,.28); }
    .rules-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e6ed; }
    .rules-head h2 { margin: 0; font-size: 16px; }
    .rules-x { background: none; border: 0; font-size: 24px; line-height: 1; color: #7a869c; cursor: pointer; }
    .rules-section { margin: 14px 0; }
    .rules-section h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; color: #124a80; }
    .rules-card label { display: block; font-weight: 600; font-size: 12px; margin: 8px 0 3px; }
    .rules-card input[type=text], .rules-card select { width: 100%; padding: 7px 9px; border: 1px solid #c9d1de; border-radius: 6px; font: inherit; background: #fff; }
    .rules-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .rules-step { border: 1px solid #e2e6ed; border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: #f8fafc; display: grid; gap: 6px; }
    .rules-btn { background: #124a80; color: #fff; border: 1px solid #124a80; border-radius: 6px; padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; }
    .rules-btn.secondary { background: #fff; color: #124a80; }
    .rules-btn.danger { background: #fff; color: #a3291c; border-color: #a3291c; }
    .rules-item { border: 1px solid #e2e6ed; border-radius: 8px; padding: 10px 12px; margin: 8px 0; display: flex; gap: 10px; align-items: center; justify-content: space-between; }
    .rules-muted { color: #7a869c; font-size: 12px; }
    .rules-error { background: #fdecea; color: #a3291c; border-radius: 6px; padding: 8px 10px; margin: 10px 0; white-space: pre-wrap; }
    .rules-result { background: #e5f6ee; color: #166f4c; border-radius: 6px; padding: 8px 10px; margin-top: 6px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.value !== undefined) node.value = props.value;
    if (props.placeholder) node.placeholder = props.placeholder;
    for (const child of children) node.appendChild(child);
    return node;
  }

  function mount(shadow, { onChange, getSample } = {}) {
    const or = () => globalThis.SXRTS.outputRules;
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    const modal = el("div", { className: "rules-modal" });
    const card = el("div", { className: "rules-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop) close(); });

    let view = "list";
    let draft = null;

    function close() { modal.classList.remove("open"); }
    const newDraft = () => ({ label: "", target: "smi.facebook", steps: [{ type: "lastPathSegment" }], sample: null, error: "" });

    function sampleFor(target) {
      return draft.sample ?? getSample?.(target) ?? or().TARGETS.find((t) => t.id === target)?.example ?? "";
    }

    function renderList() {
      card.replaceChildren();
      const x = el("button", { className: "rules-x", text: "×", type: "button", title: "Close" });
      x.addEventListener("click", close);
      card.appendChild(el("div", { className: "rules-head" }, [el("h2", { text: "Output rules" }), x]));
      const add = el("button", { className: "rules-btn", text: "Add rule", type: "button" });
      add.addEventListener("click", () => { draft = newDraft(); view = "edit"; render(); });
      card.appendChild(el("div", { className: "rules-row" }, [add]));
      card.appendChild(el("p", { className: "rules-muted", text: "A rule changes the agent's output before it is previewed or written to RTS, for example keeping only a Facebook handle instead of the whole URL. Rules you make are saved in this browser; team rules come with the extension. All of them apply to every profile." }));
      const rules = or().getCached();
      if (!rules.length) card.appendChild(el("p", { className: "rules-muted", text: "No rules yet." }));
      for (const rule of rules) {
        const target = or().TARGETS.find((t) => t.id === rule.target)?.label ?? rule.target;
        const edit = el("button", { className: "rules-btn secondary", text: "Edit", type: "button" });
        edit.addEventListener("click", () => { draft = { ...rule, steps: rule.steps.map((s) => ({ ...s })), sample: null, error: "" }; view = "edit"; render(); });
        const fromTeam = or().isFromTeam(rule);
        const overrides = or().overridesTeam(rule);
        const buttons = [edit];
        if (!fromTeam) {
          const del = el("button", { className: "rules-btn danger", text: overrides ? "Reset to team default" : "Delete", type: "button" });
          del.addEventListener("click", async () => {
            if (!window.confirm(overrides ? `Go back to the team version of "${rule.label}"?` : `Delete the rule "${rule.label}"?`)) return;
            await or().removeRule(rule.id);
            onChange?.();
            render();
          });
          buttons.push(del);
        }
        const origin = fromTeam ? "  ·  team default" : overrides ? "  ·  your change (replaces the team default)" : "";
        card.appendChild(el("div", { className: "rules-item" }, [
          el("div", {}, [el("div", { text: rule.label + origin }), el("div", { className: "rules-muted", text: `${target}: ${or().describeSteps(rule.steps)}` })]),
          el("div", { className: "rules-row" }, buttons)
        ]));
      }
    }

    function stepEditor(step, index, refreshResult) {
      const typeSelect = el("select");
      for (const [type, def] of Object.entries(or().STEPS)) typeSelect.appendChild(el("option", { value: type, text: def.label }));
      typeSelect.value = step.type;
      typeSelect.addEventListener("change", () => { draft.steps[index] = { type: typeSelect.value }; renderEdit(); });
      const wrap = el("div", { className: "rules-step" }, [typeSelect]);
      for (const param of or().STEPS[step.type].params) {
        const input = el("input", { type: "text", value: step[param] ?? "", placeholder: param === "find" ? "text to find" : param === "with" ? "replace with (can be empty)" : "text" });
        input.addEventListener("input", () => { step[param] = input.value; refreshResult(); });
        wrap.appendChild(input);
      }
      const remove = el("button", { className: "rules-btn danger", text: "Remove step", type: "button" });
      remove.addEventListener("click", () => { draft.steps.splice(index, 1); renderEdit(); });
      wrap.appendChild(remove);
      return wrap;
    }

    function renderEdit() {
      card.replaceChildren();
      const x = el("button", { className: "rules-x", text: "×", type: "button", title: "Back" });
      x.addEventListener("click", () => { view = "list"; render(); });
      card.appendChild(el("div", { className: "rules-head" }, [el("h2", { text: draft.id ? "Edit rule" : "New rule" }), x]));

      const labelInput = el("input", { type: "text", value: draft.label, placeholder: "e.g. Facebook handle only" });
      labelInput.addEventListener("input", () => { draft.label = labelInput.value; });
      const targetSelect = el("select");
      for (const target of or().TARGETS) targetSelect.appendChild(el("option", { value: target.id, text: target.label }));
      targetSelect.value = draft.target;
      targetSelect.addEventListener("change", () => { draft.target = targetSelect.value; draft.sample = null; renderEdit(); });
      card.appendChild(el("div", { className: "rules-section" }, [
        el("h3", { text: "1 · Which field?" }), el("label", { text: "Rule name" }), labelInput, el("label", { text: "Applies to" }), targetSelect
      ]));

      const result = el("div", { className: "rules-result" });
      const sampleInput = el("input", { type: "text", value: sampleFor(draft.target) });
      const refreshResult = () => {
        draft.sample = sampleInput.value;
        result.textContent = `→ ${or().runSteps(draft.steps, sampleInput.value)}`;
      };
      sampleInput.addEventListener("input", refreshResult);

      const stepsSection = el("div", { className: "rules-section" }, [el("h3", { text: "2 · What should change? (steps run in order)" })]);
      draft.steps.forEach((step, index) => stepsSection.appendChild(stepEditor(step, index, refreshResult)));
      const addStep = el("button", { className: "rules-btn secondary", text: "Add step", type: "button" });
      addStep.addEventListener("click", () => { if (draft.steps.length < 8) { draft.steps.push({ type: "trim" }); renderEdit(); } });
      stepsSection.appendChild(el("div", { className: "rules-row" }, [addStep]));
      card.appendChild(stepsSection);

      card.appendChild(el("div", { className: "rules-section" }, [el("h3", { text: "3 · Try it" }), el("label", { text: "Example value" }), sampleInput, result]));
      refreshResult();

      if (draft.error) card.appendChild(el("div", { className: "rules-error", text: draft.error }));
      const save = el("button", { className: "rules-btn", text: "Save rule", type: "button" });
      save.addEventListener("click", async () => {
        try {
          await or().saveRule({ id: draft.id, label: draft.label, target: draft.target, steps: draft.steps, enabled: true });
        } catch (error) {
          draft.error = error.message;
          renderEdit();
          return;
        }
        onChange?.();
        view = "list";
        render();
      });
      const cancel = el("button", { className: "rules-btn secondary", text: "Cancel", type: "button" });
      cancel.addEventListener("click", () => { view = "list"; render(); });
      card.appendChild(el("div", { className: "rules-row" }, [save, cancel]));
    }

    function render() { if (view === "edit") renderEdit(); else renderList(); }

    function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      view = "list";
      render();
      modal.classList.add("open");
    }

    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rulesUi = { mount };
})();
