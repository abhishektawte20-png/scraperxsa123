"use strict";

/*
 * Rovo API integration for direct agent execution.
 * Stores authentication credentials in chrome.storage.local and makes API calls
 * to execute the Rovo agent and retrieve JSON responses.
 */
(() => {
  const STORAGE_KEY = "sxrts_rovo_credentials";

  // Multiple possible Rovo API endpoints to try
  const ROVO_API_ENDPOINTS = [
    "https://api.atlassian.com/rovo/agents",
    "https://rovo-gateway.atlassian.com/api/v1/agents",
    "https://rovo.atlassian.com/api/v1/agents",
    "https://rovo-api.atlassian.com/v1/agents"
  ];

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
    const errors = [];

    const payload = {
      prompt: prompt,
      cloudId: cloudId
    };

    // Try each endpoint in sequence
    for (const baseUrl of ROVO_API_ENDPOINTS) {
      const url = `${baseUrl}/${agentId}/execute`;
      console.log(`[ScraperX] Attempting Rovo API: ${url}`);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          return { success: true, data };
        } else {
          const errorText = await response.text();
          errors.push(`${url}: ${response.status} ${errorText.substring(0, 200)}`);
          console.log(`[ScraperX] Endpoint failed: ${response.status}`);
        }
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
        console.log(`[ScraperX] Fetch error: ${error.message}`);
      }
    }

    // If all endpoints failed
    const errorDetails = errors.join(" | ");
    return {
      success: false,
      error: `Failed to reach Rovo API. Tried endpoints: ${ROVO_API_ENDPOINTS.join(", ")}. Details: ${errorDetails}`
    };
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
