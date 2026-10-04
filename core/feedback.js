"use strict";

/*
 * One-click feedback: builds a message from the issue report (and, if the
 * researcher agrees, the agent's output) and posts it to the team channel's
 * incoming-webhook address. Microsoft Teams (Workflows webhook) is the main
 * target; Slack, Google Chat and Discord addresses work too.
 *
 * The address is set once by whoever owns the channel: in core/feedbackConfig.js
 * (ships to everyone) or in the Feedback window (this browser only). The
 * extension is only allowed to post to the hosts listed in ALLOWED_HOSTS (the
 * same list is in manifest.json), so a mistyped or hostile address cannot send
 * data anywhere else.
 */
(() => {
  const STORAGE_KEY = "sxrts_feedback";
  const LIMITS = { note: 2000, report: 9000, raw: 9000, discord: 1900 };

  const ALLOWED_HOSTS = [
    { kind: "teams", label: "Microsoft Teams", test: (h) => h.endsWith(".logic.azure.com") || h.endsWith(".webhook.office.com") || h.endsWith(".api.powerplatform.com") },
    { kind: "slack", label: "Slack", test: (h) => h === "hooks.slack.com" },
    { kind: "gchat", label: "Google Chat", test: (h) => h === "chat.googleapis.com" },
    { kind: "discord", label: "Discord", test: (h) => h === "discord.com" || h === "discordapp.com" }
  ];

  // { ok, kind, label, url } or { ok: false, error }
  function check(value) {
    const text = String(value ?? "").trim();
    if (!text) return { ok: false, error: "Paste the channel's webhook address first." };
    let url;
    try { url = new URL(text); } catch { return { ok: false, error: "That is not a web address." }; }
    if (url.protocol !== "https:") return { ok: false, error: "The address must start with https://." };
    const host = ALLOWED_HOSTS.find((entry) => entry.test(url.hostname.toLowerCase()));
    if (!host) return { ok: false, error: "This extension can only post to Microsoft Teams, Slack, Google Chat or Discord webhook addresses." };
    if (host.kind === "discord" && !url.pathname.startsWith("/api/webhooks/")) return { ok: false, error: "That Discord address is not a webhook address." };
    return { ok: true, kind: host.kind, label: host.label, url: text };
  }

  function clip(text, max) {
    const value = String(text ?? "");
    return value.length <= max ? value : `${value.slice(0, max)}\n… (cut here; ${value.length} characters in total)`;
  }

  // The report box holds a readable part and, after a "JSON" line, the same
  // data again for programs. Only the readable part is sent.
  function readablePart(report) {
    const text = String(report ?? "");
    const cut = text.indexOf("\nJSON\n");
    return (cut >= 0 ? text.slice(0, cut) : text).trim();
  }

  function build({ note, name, report, raw, includeOutput, meta = {} }) {
    const where = [meta.company, meta.domain].filter(Boolean).join(" · ") || "no company";
    return {
      title: `ScraperX feedback · ${where}`,
      facts: [
        ["From", String(name || "").trim() || "(no name given)"],
        ["Company", meta.company || "—"],
        ["Website", meta.domain || "—"],
        ["PBID", meta.pbid || "—"],
        ["Tool version", meta.version || "—"],
        ["Sent", meta.sentAt || new Date().toISOString()]
      ],
      note: clip(String(note || "").trim() || "(no comment written)", LIMITS.note),
      report: clip(readablePart(report), LIMITS.report),
      output: includeOutput && raw ? clip(raw, LIMITS.raw) : ""
    };
  }

  const chunks = (text, size = 3000) => {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  };

  function plainText(message) {
    return [
      message.title,
      ...message.facts.map(([k, v]) => `${k}: ${v}`),
      "",
      "Comment:",
      message.note,
      "",
      "Issue report:",
      message.report,
      ...(message.output ? ["", "Agent output:", message.output] : [])
    ].join("\n");
  }

  function body(kind, message) {
    if (kind === "teams") {
      const blob = (text) => ({ type: "TextBlock", text, wrap: true, fontType: "Monospace", size: "Small" });
      return {
        type: "message",
        attachments: [{
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            msteams: { width: "Full" },
            body: [
              { type: "TextBlock", text: message.title, weight: "Bolder", size: "Medium", wrap: true },
              { type: "FactSet", facts: message.facts.map(([title, value]) => ({ title, value: String(value) })) },
              { type: "TextBlock", text: "Comment", weight: "Bolder", separator: true },
              { type: "TextBlock", text: message.note, wrap: true },
              { type: "TextBlock", text: "Issue report", weight: "Bolder", separator: true },
              ...chunks(message.report).map(blob),
              ...(message.output ? [{ type: "TextBlock", text: "Agent output", weight: "Bolder", separator: true }, ...chunks(message.output).map(blob)] : [])
            ]
          }
        }]
      };
    }
    if (kind === "discord") return { content: clip(plainText({ ...message, report: "", output: "" }) + `\n${message.report}`, LIMITS.discord) };
    return { text: plainText(message) };
  }

  // Runs in the extension's background worker (the only place allowed to post).
  async function send(url, message, fetchImpl = globalThis.fetch) {
    const verdict = check(url);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    let response;
    try {
      response = await fetchImpl(verdict.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(verdict.kind, message)) });
    } catch (error) {
      return { ok: false, error: `Could not reach ${verdict.label}: ${error.message || error}` };
    }
    if (!response.ok) return { ok: false, error: `${verdict.label} refused the message (HTTP ${response.status}). Check that the webhook address is still active.` };
    return { ok: true, label: verdict.label };
  }

  // ---- the channel address (page side) ----

  async function getUrl() {
    const shipped = globalThis.SXRTS?.feedbackConfig?.webhookUrl || "";
    try {
      const stored = await globalThis.chrome?.storage?.local?.get(STORAGE_KEY);
      return stored?.[STORAGE_KEY]?.url || shipped;
    } catch {
      return shipped;
    }
  }

  async function setUrl(value) {
    const area = globalThis.chrome?.storage?.local;
    if (!String(value ?? "").trim()) { await area.remove(STORAGE_KEY); return { ok: true, cleared: true }; }
    const verdict = check(value);
    if (verdict.ok) await area.set({ [STORAGE_KEY]: { url: verdict.url } });
    return verdict;
  }

  // The written-up message for people who have no channel configured.
  const asText = (message) => plainText(message);

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.feedback = { STORAGE_KEY, ALLOWED_HOSTS, check, build, body, send, getUrl, setUrl, asText };
})();
