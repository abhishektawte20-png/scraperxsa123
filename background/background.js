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

const OAUTH_CONFIG = {
  CLIENT_ID: "SbT8O2u9oueHTM7evt4tz2OzL12Ez5KM",
  CLIENT_SECRET: "ATOAcrnfJYvJWjvfIkR7xboPN2zjuIK_37nYiFeo3_cVbn1zqc8h-VlPCRfQgj9yZRdp974CF5B5",
  REDIRECT_URI: "chrome-extension://kfofjegmajndgnkoenccggdgdmajpopg/oauth.html",
  TOKEN_URL: "https://api.atlassian.com/oauth/token",
  ROVO_API: "https://xp.atlassian.com/v1/rgstr"
};

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

// Handle OAuth and Rovo API calls from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[ScraperX Background] Received message:", request.action);

  if (request.action === "exchangeOAuthCode") {
    exchangeAuthorizationCode(request.code)
      .then(tokens => {
        console.log("[ScraperX Background] OAuth exchange successful");
        sendResponse({ success: true, tokens });
      })
      .catch(error => {
        console.error("[ScraperX Background] OAuth exchange failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "refreshOAuthToken") {
    refreshAccessToken(request.refreshToken)
      .then(accessToken => {
        console.log("[ScraperX Background] Token refresh successful");
        sendResponse({ success: true, accessToken });
      })
      .catch(error => {
        console.error("[ScraperX Background] Token refresh failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "runRovoAgent") {
    runRovoAgent(request.prompt, request.agentId, request.cloudId, request.accessToken)
      .then(result => {
        console.log("[ScraperX Background] Agent execution successful");
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error("[ScraperX Background] Agent execution failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function exchangeAuthorizationCode(code) {
  console.log("[ScraperX Background] Exchanging authorization code for tokens...");

  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: OAUTH_CONFIG.CLIENT_ID,
      client_secret: OAUTH_CONFIG.CLIENT_SECRET,
      code: code,
      redirect_uri: OAUTH_CONFIG.REDIRECT_URI
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type
  };

  return tokens;
}

async function refreshAccessToken(refreshToken) {
  console.log("[ScraperX Background] Refreshing access token...");

  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: OAUTH_CONFIG.CLIENT_ID,
      client_secret: OAUTH_CONFIG.CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type
  };

  // Update stored tokens
  chrome.storage.local.set({ "sxrts_rovo_oauth": tokens });

  return data.access_token;
}

async function runRovoAgent(prompt, agentId, cloudId, accessToken) {
  console.log("[ScraperX Background] Calling Rovo agent API...");
  console.log("[ScraperX Background] Endpoint:", OAUTH_CONFIG.ROVO_API);
  console.log("[ScraperX Background] Agent ID:", agentId, "Cloud ID:", cloudId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const payload = {
      prompt: prompt,
      cloudId: cloudId,
      agentId: agentId
    };

    const response = await fetch(OAUTH_CONFIG.ROVO_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log("[ScraperX Background] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ScraperX Background] HTTP error:", errorText);
      throw new Error(`Rovo API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log("[ScraperX Background] Successfully received response");
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("[ScraperX Background] Error:", error.name, error.message);
    if (error.name === "AbortError") {
      throw new Error("Rovo API request timed out after 30 seconds");
    }
    throw error;
  }
}
