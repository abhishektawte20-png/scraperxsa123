"use strict";

const ASSISTANT_FILES = [
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
  "core/workflows/customField.js",
  "core/workflows/treePicker.js",
  "content/ui.js",
  "content/teach.js",
  "content/rules.js",
  "content/history.js",
  "content/feedback.js",
  "content/game.js",
  "content/panel.js",
  "content/bootstrap.js"
];

importScripts("../core/history.js", "../core/feedback.js");

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
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("sxrts-history-purge", { periodInMinutes: 360 }); purgeHistory(); });
chrome.runtime.onStartup.addListener(purgeHistory);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "sxrts-history-purge") purgeHistory(); });

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "sx-window-stage" && sender.tab) lastStage.set(sender.tab.id, message.stage);
});

function watchForNewWindow(openerTabId, origin) {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error("No popup window opened. If a window for this form is already open, close it and try again. Otherwise check that the button you picked is the real, enabled button (a greyed-out button or the box around it opens nothing) and re-pick it; if it is right, allow pop-ups for rts.pitchbook.com (Chrome settings > Privacy and security > Site settings > Pop-ups and redirects), then try again."));
    }, WINDOW_OPEN_TIMEOUT);
    // A script-opened window is created blank and may not name its opener
    // yet; only a tab that names a different opener is ruled out here. The
    // address is checked once it has loaded (waitUntilLoaded).
    function onCreated(tab) {
      if (tab.openerTabId !== undefined && tab.openerTabId !== openerTabId) return;
      stop();
      resolve(tab.id);
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
      stop();
      resolve(tabId);
    }
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
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

// Chrome's wording when a window goes away while a script is still running in it.
const WINDOW_GONE = /Frame with ID|was removed|No tab with id|tab was closed|frame was removed/i;

// A window that was only used to choose or check a tree is closed from here, after its result has been
// delivered: closing it from inside the page races with the result and loses it.
function closeLater(tabId) {
  setTimeout(() => { chrome.tabs.remove(tabId).catch(() => { /* already gone */ }); }, 400);
}

async function runInWindow(tabId, job) {
  lastStage.delete(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: WINDOW_RUN_FILES });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (windowJob) => globalThis.SXRTS.workflows.popupWindow.run(windowJob),
      args: [job]
    });
    // A page that navigates or closes itself as soon as Save is accepted (RTS submits the industry form)
    // ends the script without a result: that is "the window went away after Save", not a value.
    if (injection?.result === undefined || injection?.result === null) {
      if (lastStage.get(tabId) === "saveClicked") return { status: "windowClosedAfterSave" };
      throw new Error("The window closed before it reported back. Nothing was confirmed.");
    }
    if (job?.tree) closeLater(tabId);
    return injection.result;
  } catch (error) {
    const gone = WINDOW_GONE.test(String(error?.message ?? error));
    // The page may close its own window as soon as Save is accepted.
    if (lastStage.get(tabId) === "saveClicked") return { status: "windowClosedAfterSave" };
    // Not known whether Save was reached: the page reopens the window and reads the tick back, which settles it.
    if (gone && job?.tree && !job.verifyOnly) return { status: "windowClosedAfterSave", unsure: true };
    if (gone && job?.tree) throw new Error("The window closed before it could be read.");
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
    try {
      const opened = watchForNewWindow(openerTabId, message.origin);
      opened.catch(() => {});
      say({ type: "armed" });
      const tabId = await opened;
      await waitUntilLoaded(tabId, message.origin);
      if (message.mode === "pick") {
        await startPicker(tabId, message.token);
        say({ type: "picker-open" });
      } else {
        say({ type: "result", result: await runInWindow(tabId, message.job) });
      }
    } catch (error) {
      say({ type: "error", error: error.message });
    }
  });
});
