"use strict";

/*
 * Rovo API integration for direct agent execution.
 * Stores authentication credentials in chrome.storage.local and makes API calls
 * to execute the Rovo agent and retrieve JSON responses.
 */
(() => {
  const STORAGE_KEY = "sxrts_rovo_credentials";

  async function getStoredCredentials() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  async function setStoredCredentials(email, token, cloudId, agentId) {
    const credentials = { email, token, cloudId, agentId, timestamp: Date.now() };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: credentials }, () => {
        resolve(credentials);
      });
    });
  }

  async function clearStoredCredentials() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEY], () => {
        resolve();
      });
    });
  }

  async function runAgent(prompt) {
    const credentials = await getStoredCredentials();

    if (!credentials) {
      throw new Error("Rovo credentials not configured. Please set up your Atlassian API credentials first.");
    }

    // Use background script to avoid CORS issues
    return new Promise((resolve) => {
      console.log("[ScraperX] Sending message to background script");

      try {
        chrome.runtime.sendMessage(
          { action: "runRovoAgent", prompt, credentials },
          (response) => {
            console.log("[ScraperX] Received response from background:", response);

            if (chrome.runtime.lastError) {
              console.error("[ScraperX] Chrome runtime error:", chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }

            if (response?.success) {
              console.log("[ScraperX] Agent execution successful");
              resolve({ success: true, data: response.data });
            } else {
              console.error("[ScraperX] Agent execution failed:", response?.error);
              resolve({ success: false, error: response?.error || "Unknown error from background script" });
            }
          }
        );
      } catch (error) {
        console.error("[ScraperX] Error sending message:", error);
        resolve({ success: false, error: error.message });
      }
    });
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rovoApi = {
    getStoredCredentials,
    setStoredCredentials,
    clearStoredCredentials,
    runAgent
  };
})();
