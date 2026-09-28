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
  console.log("[ScraperX Background] Received message:", request.action);

  if (request.action === "runRovoAgent") {
    console.log("[ScraperX Background] Processing runRovoAgent request");
    runRovoAgent(request.prompt, request.credentials)
      .then(result => {
        console.log("[ScraperX Background] Agent execution successful");
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error("[ScraperX Background] Agent execution error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  } else {
    console.log("[ScraperX Background] Unhandled message action:", request.action);
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

  console.log("[ScraperX Background] Calling Rovo API...");
  console.log("[ScraperX Background] Endpoint: https://xp.atlassian.com/v1/rostr");
  console.log("[ScraperX Background] Payload:", JSON.stringify(payload, null, 2));

  try {
    console.log("[ScraperX Background] Starting fetch request...");

    const response = await fetch("https://xp.atlassian.com/v1/rostr", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("[ScraperX Background] Response received. Status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ScraperX Background] HTTP Error Response:", errorText);
      throw new Error(`Rovo API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log("[ScraperX Background] Successfully parsed JSON response");
    return data;
  } catch (error) {
    console.error("[ScraperX Background] Exception caught:", error.name, error.message);
    console.error("[ScraperX Background] Full error:", error);
    throw error;
  }
}
