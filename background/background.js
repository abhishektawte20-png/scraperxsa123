"use strict";

const ASSISTANT_FILES = [
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
  "core/teamDefaults.js",
  "core/customFields.js",
  "core/outputRules.js",
  "core/teamShare.js",
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
  "content/panel.js",
  "content/bootstrap.js"
];

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ASSISTANT_FILES
    });
  } catch (error) {
    console.error("ScraperX RTS Profile Assistant could not open on this page.", error);
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
const WINDOW_PICK_FILES = ["core/selectorBuilder.js", "content/popupPicker.js"];
const WINDOW_OPEN_TIMEOUT = 10000;
const lastStage = new Map();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "sx-window-stage" && sender.tab) lastStage.set(sender.tab.id, message.stage);
});

function watchForNewWindow(openerTabId, origin) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onCreated.removeListener(onCreated);
      reject(new Error("No popup window opened. If Chrome blocked it, allow pop-ups for rts.pitchbook.com (Chrome settings > Privacy and security > Site settings > Pop-ups and redirects), then try again."));
    }, WINDOW_OPEN_TIMEOUT);
    // A script-opened window is created blank and may not name its opener
    // yet; only a tab that names a different opener is ruled out here. The
    // address is checked once it has loaded (waitUntilLoaded).
    function onCreated(tab) {
      if (tab.openerTabId !== undefined && tab.openerTabId !== openerTabId) return;
      clearTimeout(timer);
      chrome.tabs.onCreated.removeListener(onCreated);
      resolve(tab.id);
    }
    chrome.tabs.onCreated.addListener(onCreated);
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

async function runInWindow(tabId, job) {
  lastStage.delete(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: WINDOW_RUN_FILES });
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (windowJob) => globalThis.SXRTS.workflows.popupWindow.run(windowJob),
      args: [job]
    });
    return injection.result;
  } catch (error) {
    // The page may close its own window as soon as Save is accepted.
    if (lastStage.get(tabId) === "saveClicked") return { status: "windowClosedAfterSave" };
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
