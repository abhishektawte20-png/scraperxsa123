"use strict";

const ASSISTANT_FILES = [
  "core/dialogLog.js",
  "core/runControl.js",
  "core/jsonRepair.js",
  "core/rovoContract.js",
  "core/rovoText.js",
  "core/schema.js",
  "core/identityLock.js",
  "core/duplicates.js",
  "core/cache.js",
  "core/stateMachine.js",
  "core/adapters/textField.js",
  "core/adapters/nativeSelect.js",
  "core/adapters/contentEditable.js",
  "core/navigation.js",
  "core/resultsSummary.js",
  "core/issueReport.js",
  "core/pageCapture.js",
  "core/teamDefaults.js",
  "core/customFields.js",
  "core/outputRules.js",
  "core/teamShare.js",
  "core/history.js",
  "core/fieldStats.js",
  "core/undoLedger.js",
  "core/feedback.js",
  "core/feedbackConfig.js",
  "core/outputFields.js",
  "core/selectorBuilder.js",
  "registry/businessEntity.nameVariations.js",
  "registry/businessEntity.general.js",
  "registry/company.sic.js",
  "registry/company.sites.js",
  "registry/index.js",
  "core/agentSpec.js",
  "core/promptBuilder.js",
  "core/executionPlan.js",
  "core/workflows/businessEntityNameVariations.js",
  "core/workflows/businessEntityGeneral.js",
  "core/workflows/companySic.js",
  "core/workflows/companySite.js",
  "core/workflows/statusHistory.js",
  "core/workflows/verticals.js",
  "core/workflows/customField.js",
  "core/workflows/treePicker.js",
  "content/ui.js",
  "content/teach.js",
  "content/rules.js",
  "content/mappings.js",
  "content/history.js",
  "content/undo.js",
  "content/feedback.js",
  "content/game.js",
  "content/panel.js",
  "content/bootstrap.js"
];

importScripts("../core/history.js", "../core/feedback.js", "../core/resultsSummary.js", "../core/outputFields.js", "../core/fieldStats.js");

/*
 * Feedback and history housekeeping.
 * - "Send feedback": the page hands the message to this worker, which is the
 *   only place allowed to post (and only to the webhook hosts in the manifest).
 * - History older than its retention period is erased when the browser starts,
 *   when the extension is installed or updated, and every few hours.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "sxrts-send-feedback" || sender.id !== chrome.runtime.id) return false;
  globalThis.SXRTS.feedback.send(message.url, message.message).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

const purgeHistory = () => globalThis.SXRTS.history.purge().catch(() => {});

/*
 * Weekly digest. Once a week the field-health numbers and the failure log of this browser are posted to the
 * team channel (the same webhook as "Send feedback"). Without a channel nothing is sent and nothing is lost:
 * the digest can be opened and copied from "Field health" at any time.
 */
async function maybeSendDigest(now = Date.now()) {
  const { fieldStats, feedback } = globalThis.SXRTS;
  const state = await fieldStats.getState();
  if (!state.lastSentAt) { await fieldStats.setState({ ...state, lastSentAt: now }); return { sent: false, reason: "started counting" }; }
  if (now - state.lastSentAt < 7 * fieldStats.DAY) return { sent: false, reason: "not due" };
  const url = await feedback.getUrl();
  if (!url) return { sent: false, reason: "no channel" };
  const { text, summary } = await fieldStats.digestText(await fieldStats.readAll(), { since: state.lastSentAt, now });
  if (!summary.total.tried && !summary.total.unmapped) { await fieldStats.setState({ ...state, lastSentAt: now }); return { sent: false, reason: "no runs" }; }
  let name = "";
  try { name = (await chrome.storage.local.get("sxrts_feedback_name"))?.sxrts_feedback_name || ""; } catch { /* optional */ }
  const message = {
    title: "ScraperX weekly digest",
    facts: [["From", name || "(no name given)"], ["Tool version", chrome.runtime.getManifest().version], ["Fields attempted", String(summary.total.tried)], ["Failed", String(summary.total.failed)], ["Success rate", fieldStats.pct(summary.total.rate)]],
    note: "Automatic weekly digest.", report: text, captures: "", output: ""
  };
  const result = await feedback.send(url, message);
  if (result.ok) await fieldStats.setState({ ...state, lastSentAt: now });
  return { sent: result.ok, reason: result.error || "" };
}
const housekeeping = () => { purgeHistory(); maybeSendDigest().catch(() => {}); };
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("sxrts-history-purge", { periodInMinutes: 360 }); housekeeping(); });
chrome.runtime.onStartup.addListener(housekeeping);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "sxrts-history-purge") housekeeping(); });

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    // RTS's own message boxes are answered by a small script that runs in the page itself.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: [DIALOG_GUARD], world: "MAIN" }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ASSISTANT_FILES
    });
  } catch (error) {
    console.error("ScraperX UI Automation Tool could not open on this page.", error);
  }
});

/*
 * Popup windows. Some RTS forms open in a separate browser window (for
 * example Social Media Identifier -> "New"). A content script can only touch
 * its own tab, so the page asks this worker to watch for the window its next
 * click opens, and then to run the fill (or the field picker) inside it.
 * The page talks to us over a port named "sx-window".
 */
const DIALOG_GUARD = "core/dialogGuardMain.js";
const WINDOW_RUN_FILES = [
  "core/identityLock.js",
  "core/adapters/textField.js",
  "core/adapters/nativeSelect.js",
  "core/selectorBuilder.js",
  "core/workflows/popupWindow.js"
];
const WINDOW_PICK_FILES = ["core/selectorBuilder.js", "core/pageCapture.js", "content/popupPicker.js"];
const WINDOW_OPEN_TIMEOUT = 10000;
const lastStage = new Map();
const stageTrail = new Map();
const trailText = (tabId) => { const trail = stageTrail.get(tabId) ?? []; const t0 = trail[0]?.[1] ?? 0; return trail.length ? trail.map(([stage, at]) => `${stage} +${((at - t0) / 1000).toFixed(1)}s`).join(" → ") : "none"; };
// A window that goes away after the choice was clicked or Save was pressed is not a failure by itself: the page reopens it and reads the tick back.
const WENT_AWAY_STAGES = ["tickClicking", "saveClicked"];

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "sx-window-stage" && sender.tab) {
    lastStage.set(sender.tab.id, message.stage);
    const trail = stageTrail.get(sender.tab.id) ?? [];
    trail.push([message.stage, Date.now()]);
    stageTrail.set(sender.tab.id, trail);
  }
});

// Pop-up windows of the RTS site other than the one the opener tab lives in (newest-used first).
async function popupTabs(openerTabId, origin) {
  const opener = await chrome.tabs.get(openerTabId).catch(() => null);
  const tabs = await chrome.tabs.query({ url: `${origin}/*` }).catch(() => []);
  const found = [];
  for (const tab of tabs) {
    if (tab.id === openerTabId || tab.windowId === opener?.windowId) continue;
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (win?.type === "popup") found.push(tab);
  }
  return found.sort((a, b) => (Number(b.openerTabId === openerTabId) - Number(a.openerTabId === openerTabId)) || ((b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)) || b.id - a.id);
}

// If pressing the button opens nothing new, a window for the form is probably already open (RTS reuses it
// and only brings it to the front). After this long the worker uses that window instead of giving up.
const ADOPT_AFTER = 2500;
const NO_WINDOW = "No popup window opened. Close any window of this form that is open and try again. If none is open, check that the button you picked is the real, enabled button (a greyed-out button or the box around it opens nothing) and re-pick it; if it is right, allow pop-ups for rts.pitchbook.com (Chrome settings > Privacy and security > Site settings > Pop-ups and redirects).";

// Resolves { tabId, adopted }. `known` = ids of the pop-up windows that were already open.
function watchForNewWindow(openerTabId, origin, known = new Set()) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timers = [];
    const stop = () => {
      done = true;
      timers.forEach(clearTimeout);
      clearInterval(poll);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const found = (tabId, adopted = false) => { if (done) return; stop(); resolve({ tabId, adopted }); };
    timers.push(setTimeout(() => { if (done) return; stop(); reject(new Error(NO_WINDOW)); }, WINDOW_OPEN_TIMEOUT));
    // A script-opened window is created blank and may not name its opener
    // yet; only a tab that names a different opener is ruled out here. The
    // address is checked once it has loaded (waitUntilLoaded).
    function onCreated(tab) {
      if (tab.openerTabId !== undefined && tab.openerTabId !== openerTabId) return;
      found(tab.id);
    }
    // RTS opens some windows under a fixed name, so a window that is already open is navigated
    // instead of a new one being created. Treat a pop-up window of this site that starts loading as the one.
    async function onUpdated(tabId, changeInfo, tab) {
      if (tabId === openerTabId || (changeInfo.status !== "loading" && !changeInfo.url)) return;
      if (!String(changeInfo.url || tab?.url || "").startsWith(origin)) return;
      try {
        const win = await chrome.windows.get(tab.windowId);
        if (win.type !== "popup") return;
      } catch { return; }
      found(tabId);
    }
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Safety net: a pop-up that was not there before, even if no event named it.
    const poll = setInterval(async () => {
      const now = await popupTabs(openerTabId, origin);
      const fresh = now.find((tab) => !known.has(tab.id));
      if (fresh) found(fresh.id);
    }, 300);
    // Nothing new appeared: use the window that is already open.
    timers.push(setTimeout(async () => {
      if (done) return;
      const open = await popupTabs(openerTabId, origin);
      if (open.length && !done) {
        chrome.windows.update(open[0].windowId, { focused: true }).catch(() => {});
        found(open[0].id, true);
      }
    }, ADOPT_AFTER));
  });
}

async function waitUntilLoaded(tabId, origin) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && (tab.url || "").startsWith(origin)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("The popup window opened but did not finish loading.");
}

// A window that finished its job closes itself a moment later. The next job must not find that dying window and
// take it for its own, so after a job the worker waits until the window is really gone (at most a few seconds).
async function waitUntilGone(tabId, limit = 3500) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    try { await chrome.tabs.get(tabId); } catch { return true; }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

async function runInWindow(tabId, job) {
  const result = await runInWindowOnce(tabId, job);
  if (result?.status === "saved" || result?.status === "verified" || result?.status === "skipped" || result?.status === "clicked") await waitUntilGone(tabId);
  return result;
}

async function runInWindowOnce(tabId, job) {
  lastStage.delete(tabId);
  stageTrail.delete(tabId);
  // RTS's own message boxes in the window (for example the confirmation it asks before saving an industry group) are
  // answered at once, so nobody has to be at the computer. Never fatal: without it the boxes simply wait for a person.
  await chrome.scripting.executeScript({ target: { tabId }, files: [DIALOG_GUARD], world: "MAIN" }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, func: () => document.documentElement.setAttribute("data-sx-run", "1") }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: WINDOW_RUN_FILES });
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (windowJob) => globalThis.SXRTS.workflows.popupWindow.run(windowJob),
      args: [job]
    });
    // A page that navigates or closes itself as soon as Save is accepted (RTS submits the industry form)
    // ends the script without a result: that is "the window went away after Save", not a value.
    if (injection?.result === undefined || injection?.result === null) {
      if (WENT_AWAY_STAGES.includes(lastStage.get(tabId))) return { status: "windowClosedAfterSave" };
      // Let the dying window finish going away before anything else can look for a window.
      await waitUntilGone(tabId, 2500);
      throw new Error(`The window closed before it reported back (steps it reached: ${trailText(tabId)}; "none" means it closed while it was still loading or being read). Nothing was confirmed.`);
    }
    return injection.result;
  } catch (error) {
    // The page may close its own window as soon as Save is accepted. Only an error that says the window or frame went
    // away counts as that; a real message from the job (for example "RTS did not accept the save") is passed on.
    const wentAway = /Frame with ID|frame was removed|No tab with id|tab was closed|was removed|Cannot access|detached|No frame/i.test(String(error?.message));
    if (wentAway && WENT_AWAY_STAGES.includes(lastStage.get(tabId))) return { status: "windowClosedAfterSave" };
    throw error;
  }
}

async function startPicker(tabId, token) {
  await chrome.scripting.executeScript({ target: { tabId }, files: WINDOW_PICK_FILES });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (pickToken) => globalThis.SXRTS.popupPicker.start(pickToken),
    args: [token]
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sx-window") return;
  const openerTabId = port.sender?.tab?.id;
  const say = (message) => { try { port.postMessage(message); } catch { /* the page went away */ } };

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "start" || openerTabId === undefined) return;
    // Paused: no window is opened or driven.
    try {
      if ((await chrome.storage.local.get("sxrts_paused"))?.sxrts_paused) { say({ type: "error", error: "The extension is paused, so no window was opened. Press Resume in the panel to continue." }); return; }
    } catch { /* no storage: carry on */ }
    let adopted = false;
    try {
      let already = await popupTabs(openerTabId, message.origin);
      if (message.fresh && already.length) {
        // The window that was in use did not work (an old page in it): close it so the button opens a clean one.
        await chrome.tabs.remove(already.map((tab) => tab.id)).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 600));
        already = await popupTabs(openerTabId, message.origin);
      }
      const opened = watchForNewWindow(openerTabId, message.origin, new Set(already.map((tab) => tab.id)));
      opened.catch(() => {});
      say({ type: "armed" });
      const found = await opened;
      adopted = found.adopted;
      const tabId = found.tabId;
      await waitUntilLoaded(tabId, message.origin);
      if (message.mode === "pick") {
        await startPicker(tabId, message.token);
        say({ type: "picker-open" });
      } else {
        say({ type: "result", result: await runInWindow(tabId, message.job) });
      }
    } catch (error) {
      // `stale`: the worker used a window that was already open and it did not work; the page may try once more with a clean one.
      say({ type: "error", error: error.message, stale: adopted && !message.fresh });
    }
  });
});
