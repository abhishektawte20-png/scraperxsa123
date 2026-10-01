"use strict";

/*
 * Rovo API integration with OAuth 2.1 authentication.
 * Handles token exchange, refresh, and agent execution.
 */
(() => {
  const STORAGE_KEY = "sxrts_rovo_oauth";
  const CLIENT_ID = "SbT8O2u9oueHTM7evt4tz2OzL12Ez5KM";
  const REDIRECT_URI = "chrome-extension://kfofjegmajndgnkoenccggdgdmajpopg/oauth.html";
  const AUTH_URL = "https://auth.atlassian.com/authorize";
  const TOKEN_URL = "https://api.atlassian.com/oauth/token";
  const SCOPES = "read:me offline_access";

  async function getStoredTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  async function setStoredTokens(tokens) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: tokens }, () => {
        resolve(tokens);
      });
    });
  }

  async function clearStoredTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEY], () => {
        resolve();
      });
    });
  }

  async function getValidAccessToken() {
    const tokens = await getStoredTokens();
    if (!tokens) {
      throw new Error("Not authenticated. Please log in with Atlassian first.");
    }

    // Check if token is expired
    if (tokens.expiresAt && Date.now() > tokens.expiresAt) {
      console.log("[ScraperX] Access token expired, refreshing...");
      return await refreshAccessToken(tokens.refreshToken);
    }

    return tokens.accessToken;
  }

  async function refreshAccessToken(refreshToken) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "refreshOAuthToken", refreshToken },
        (response) => {
          if (response?.success) {
            resolve(response.accessToken);
          } else {
            throw new Error("Failed to refresh token: " + response?.error);
          }
        }
      );
    });
  }

  async function runAgent(prompt, agentId, cloudId) {
    const accessToken = await getValidAccessToken();

    return new Promise((resolve) => {
      console.log("[ScraperX] Sending Rovo agent execution request");

      chrome.runtime.sendMessage(
        {
          action: "runRovoAgent",
          prompt,
          agentId,
          cloudId,
          accessToken
        },
        (response) => {
          console.log("[ScraperX] Received response:", response);

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
            resolve({ success: false, error: response?.error || "Unknown error" });
          }
        }
      );
    });
  }

  function getAuthorizationUrl() {
    const state = Math.random().toString(36).substring(7);
    chrome.storage.local.set({ sxrts_oauth_state: state });

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      state: state
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.rovoApi = {
    getStoredTokens,
    setStoredTokens,
    clearStoredTokens,
    getValidAccessToken,
    runAgent,
    getAuthorizationUrl
  };
})();
