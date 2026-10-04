"use strict";

/*
 * "Send feedback" window: one click posts the issue report (and, if ticked,
 * the agent's output) to the team channel. The post is made by the extension's
 * background worker (core/feedback.js). With no channel set up, the same
 * message can be copied instead.
 */
(() => {
  const CSS = `
    .fb-modal { display: none; position: fixed; z-index: 2147483648; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; font: 13.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1b2430; }
    .fb-modal.open { display: flex; }
    .fb-card { background: #fff; border-radius: 14px; width: min(560px, 94vw); max-height: 90vh; overflow: auto; padding: 20px 22px; box-shadow: 0 20px 48px rgba(15,30,60,.28); }
    .fb-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e6ed; }
    .fb-head h2 { margin: 0; font-size: 16px; }
    .fb-x { background: none; border: 0; font-size: 24px; line-height: 1; color: #7a869c; cursor: pointer; }
    .fb-card label { display: block; font-weight: 600; font-size: 12px; margin: 10px 0 3px; }
    .fb-card textarea, .fb-card input[type=text] { width: 100%; padding: 7px 9px; border: 1px solid #c9d1de; border-radius: 6px; font: inherit; box-sizing: border-box; }
    .fb-card textarea { min-height: 90px; resize: vertical; }
    .fb-check { display: flex; gap: 8px; align-items: flex-start; font-weight: 400 !important; font-size: 13px !important; margin: 10px 0 !important; }
    .fb-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    .fb-btn { background: #124a80; color: #fff; border: 1px solid #124a80; border-radius: 6px; padding: 7px 14px; font: inherit; font-size: 12.5px; cursor: pointer; }
    .fb-btn.secondary { background: #fff; color: #124a80; } .fb-btn[disabled] { opacity: .55; cursor: default; }
    .fb-muted { color: #7a869c; font-size: 12px; }
    .fb-msg { border-radius: 6px; padding: 8px 10px; margin: 10px 0; font-size: 12.5px; }
    .fb-ok { background: #e5f6ee; color: #166f4c; } .fb-err { background: #fdecea; color: #a3291c; } .fb-info { background: #eaf2fb; color: #124a80; }
    .fb-card details { margin-top: 12px; font-size: 12.5px; } .fb-card summary { cursor: pointer; color: #124a80; font-weight: 600; }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.type) node.type = props.type;
    if (props.placeholder) node.placeholder = props.placeholder;
    for (const child of children) node.appendChild(child);
    return node;
  }

  const NAME_KEY = "sxrts_feedback_name";

  function mount(shadow, { getContext } = {}) {
    const fb = () => globalThis.SXRTS.feedback;
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    const modal = el("div", { className: "fb-modal" });
    const card = el("div", { className: "fb-card" });
    modal.appendChild(card);
    let pressedOnBackdrop = false;
    modal.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener("click", (event) => { if (event.target === modal && pressedOnBackdrop) close(); });

    let state = { comment: "", name: "", includeOutput: true, message: null, channel: "", checked: null };

    function close() { modal.classList.remove("open"); }
    const say = (text, kind) => { state.message = text ? { text, kind } : null; render(); };

    function buildMessage() {
      const context = getContext?.() ?? {};
      return fb().build({ note: state.comment, name: state.name, report: context.report, raw: context.raw, includeOutput: state.includeOutput, meta: context.meta });
    }

    async function send() {
      const url = await fb().getUrl();
      const message = buildMessage();
      say("Sending…", "info");
      let result;
      try {
        result = await chrome.runtime.sendMessage({ type: "sxrts-send-feedback", url, message });
      } catch (error) {
        result = { ok: false, error: `The extension could not send it: ${error.message || error}` };
      }
      if (!result) result = { ok: false, error: "No answer from the extension. Reload the page and try again." };
      if (result.ok) {
        try { await chrome.storage.local.set({ [NAME_KEY]: state.name }); } catch { /* optional */ }
        state.comment = "";
        say(`Sent to ${result.label}. Thank you.`, "ok");
      } else {
        say(result.error, "err");
      }
    }

    async function render() {
      card.replaceChildren();
      const x = el("button", { className: "fb-x", text: "×", type: "button", title: "Close" });
      x.addEventListener("click", close);
      card.appendChild(el("div", { className: "fb-head" }, [el("h2", { text: "Send feedback" }), x]));
      const url = await fb().getUrl();
      const channel = url ? fb().check(url) : null;

      card.appendChild(el("p", { className: "fb-muted", text: "This sends the issue report from this run to the person who maintains the tool. It includes the company, website and the messages shown in the report." }));

      card.appendChild(el("label", { text: "What went wrong, or what should be better?" }));
      const comment = el("textarea", { placeholder: "For example: Brief description saved, but RTS shows it cut off after 250 characters." });
      comment.value = state.comment;
      comment.addEventListener("input", () => { state.comment = comment.value; });
      card.appendChild(comment);

      card.appendChild(el("label", { text: "Your name (optional)" }));
      const name = el("input", { type: "text", placeholder: "So the reply can come back to you" });
      name.value = state.name;
      name.addEventListener("input", () => { state.name = name.value; });
      card.appendChild(name);

      const output = el("input", { type: "checkbox" });
      output.checked = state.includeOutput;
      output.addEventListener("change", () => { state.includeOutput = output.checked; });
      card.appendChild(el("label", { className: "fb-check" }, [output, el("span", { text: "Include the agent's output (cut to a size the channel accepts). It helps to reproduce the problem." })]));

      if (state.message) card.appendChild(el("div", { className: `fb-msg fb-${state.message.kind}`, text: state.message.text }));

      const row = el("div", { className: "fb-row" });
      const sendButton = el("button", { className: "fb-btn", text: channel?.ok ? `Send to ${channel.label}` : "Send", type: "button" });
      sendButton.disabled = !channel?.ok;
      sendButton.addEventListener("click", send);
      const copyButton = el("button", { className: "fb-btn secondary", text: "Copy instead", type: "button" });
      copyButton.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(fb().asText(buildMessage())); say("Copied. Paste it into your message.", "ok"); } catch { say("Copy was blocked by the browser.", "err"); }
      });
      row.append(sendButton, copyButton);
      card.appendChild(row);

      if (!channel?.ok) card.appendChild(el("div", { className: "fb-msg fb-info", text: url ? `The saved channel address does not work: ${channel.error}` : "No feedback channel is set up yet. Set one below (once), or use Copy instead." }));

      const settings = el("details", {}, [el("summary", { text: channel?.ok ? "Channel settings" : "Set up the channel" })]);
      settings.open = !channel?.ok;
      settings.appendChild(el("p", { className: "fb-muted", text: "Paste the webhook address of the Microsoft Teams channel (Teams: channel menu, Workflows, \"Post to a channel when a webhook request is received\"). Slack, Google Chat and Discord addresses also work. It is saved in this browser only; the team lead can build it into the extension for everyone (core/feedbackConfig.js)." }));
      const link = el("input", { type: "text", placeholder: "https://…" });
      link.value = state.checked ?? url ?? "";
      settings.appendChild(link);
      const save = el("button", { className: "fb-btn secondary", text: "Save channel address", type: "button" });
      save.addEventListener("click", async () => {
        state.checked = link.value;
        const result = await fb().setUrl(link.value);
        state.message = result.ok ? { text: result.cleared ? "Channel address removed from this browser." : `Saved. Feedback will go to ${result.label}.`, kind: "ok" } : { text: result.error, kind: "err" };
        if (result.ok) state.checked = null;
        render();
      });
      settings.appendChild(el("div", { className: "fb-row" }, [save]));
      card.appendChild(settings);
    }

    async function open() {
      if (!modal.isConnected) shadow.appendChild(modal);
      state.message = null;
      try { const stored = await chrome.storage.local.get(NAME_KEY); state.name = state.name || stored?.[NAME_KEY] || ""; } catch { /* optional */ }
      await render();
      modal.classList.add("open");
    }

    return { open, close };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.feedbackUi = { mount };
})();
