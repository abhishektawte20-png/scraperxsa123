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
  "core/customFields.js",
  "core/outputRules.js",
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
