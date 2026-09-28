"use strict";

/*
 * Rovo API integration for direct agent execution.
 * Stores authentication credentials in chrome.storage.local and makes API calls
 * to execute the Rovo agent and retrieve JSON responses.
 */
(() => {
  const STORAGE_KEY = "sxrts_rovo_credentials";

  const ROVO_API_ENDPOINT = "https://xp.atlassian.com/v1/rostr";

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

  function createBasicAuthHeader(email, token) {
    const credentials = `${email}:${token}`;
    const base64 = btoa(credentials);
    return `Basic ${base64}`;
  }

  async function executeAgent(prompt, email, token, cloudId, agentId) {
    const authHeader = createBasicAuthHeader(email, token);

    const payload = {
      prompt: prompt,
      cloudId: cloudId,
      agentId: agentId
    };

    try {
      console.log(`[ScraperX] Calling Rovo API: ${ROVO_API_ENDPOINT}`);

      const response = await fetch(ROVO_API_ENDPOINT, {
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
        console.error(`[ScraperX] API error: ${response.status} ${errorText}`);
        throw new Error(`Rovo API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log(`[ScraperX] API success: received response`);
      return { success: true, data };
    } catch (error) {
      console.error(`[ScraperX] Fetch error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async function runAgent(prompt) {
    const credentials = await getStoredCredentials();

    if (!credentials) {
      throw new Error("Rovo credentials not configured. Please set up your Atlassian API credentials first.");
    }

    return executeAgent(
      prompt,
      credentials.email,
      credentials.token,
      credentials.cloudId,
      credentials.agentId
    );
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rovoApi = {
    getStoredCredentials,
    setStoredCredentials,
    clearStoredCredentials,
    runAgent,
    executeAgent
  };
})();
