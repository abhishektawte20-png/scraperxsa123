"use strict";

const ASSISTANT_FILES = [
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
  "core/rovoApi.js",
  "registry/businessEntity.nameVariations.js",
  "registry/businessEntity.general.js",
  "registry/company.sic.js",
  "registry/company.sites.js",
  "registry/index.js",
  "core/promptBuilder.js",
  "core/executionPlan.js",
  "core/workflows/businessEntityNameVariations.js",
  "core/workflows/businessEntityGeneral.js",
  "core/workflows/companySic.js",
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

// Handle Rovo API calls from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "runRovoAgent") {
    runRovoAgent(request.prompt, request.credentials)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function runRovoAgent(prompt, credentials) {
  const { email, token, cloudId, agentId } = credentials;
  const authHeader = `Basic ${btoa(`${email}:${token}`)}`;

  const payload = {
    prompt: prompt,
    cloudId: cloudId,
    agentId: agentId
  };

  const response = await fetch("https://xp.atlassian.com/v1/rostr", {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Rovo API error (${response.status}): ${errorText}`);
  }

  return response.json();
}
