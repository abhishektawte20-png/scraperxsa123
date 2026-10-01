"use strict";

(async () => {
  const title = document.getElementById("title");
  const detail = document.getElementById("detail");

  function fail(message) {
    title.textContent = "Authentication failed";
    detail.textContent = message;
  }

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");

  if (error) {
    fail(params.get("error_description") || error);
    return;
  }
  if (!code) {
    fail("No authorization code received.");
    return;
  }

  const { sxrts_oauth_state: expectedState } = await chrome.storage.local.get("sxrts_oauth_state");
  if (!expectedState || expectedState !== state) {
    fail("State mismatch. Please start the login again from the extension.");
    return;
  }
  await chrome.storage.local.remove("sxrts_oauth_state");

  chrome.runtime.sendMessage({ action: "exchangeOAuthCode", code }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      fail(chrome.runtime.lastError?.message || response?.error || "Token exchange failed.");
      return;
    }
    title.textContent = "Logged in";
    detail.textContent = "You can close this window and return to the extension.";
    setTimeout(() => window.close(), 800);
  });
})();
