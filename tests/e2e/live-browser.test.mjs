// Real-browser end-to-end test. See README.md in this directory for why
// this exists and what it catches that the jsdom-based tests (tests/*.mjs)
// cannot. Runs the actual, unmodified extension files in a real Chromium
// browser via Playwright, against a page built from the real evidenced
// fixtures (never a hand-duplicated mock DOM).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

function fixture(name) {
  return readFileSync(path.join(repo, "fixtures", name), "utf8");
}

// Same ordered list background/background.js injects into a real tab.
const ASSISTANT_FILES = [
  "core/schema.js",
  "core/identityLock.js",
  "core/duplicates.js",
  "core/cache.js",
  "core/stateMachine.js",
  "core/adapters/textField.js",
  "core/adapters/nativeSelect.js",
  "core/adapters/contentEditable.js",
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
  "content/panel.js"
];

// The only piece not covered by an existing fixture file: the PBID header
// and (initially blank) Domain field the identity lock reads. Kept
// deliberately tiny — everything else below comes straight from the real
// evidenced fixtures, not a hand-maintained duplicate of the RTS DOM.
const IDENTITY_HEADER = `
  <span class="flat-button__caption flat-button__caption-abc123">PBID: 862926-85</span>
  <input type="text" value="" id="domainValue">
`;

// Simulates only the RTS behavior actually evidenced and already exercised
// by tests/test-name-variations.mjs and tests/test-company-sic.mjs: a new
// row appended before the Add button, and each section's Save button
// returning to disabled shortly after a click (with per-row dirty-tracking
// so a freshly added row also arms its own Save button).
const BEHAVIOR_SCRIPT = `
  const nameSave = document.getElementById("saveBusinessEntityNameVariation");
  document.getElementById("addNameVariation").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "name-variation-row";
    row.innerHTML = \`
      <input type="text" value="" data-defaultvalue="" class="input businessEntityName" data-disabled-if-dnb-field="">
      <select class="input input_select businessEntityNameType" data-disabled-if-dnb-field="">
        <option value="FAMILIAR">Familiar Name</option>
        <option value="FORMER">Former Name</option>
        <option value="LEGAL">Legal Name</option>
        <option value="OTHER" selected="selected">Other Name</option>
        <option value="NATIVE_FORMAL">Native Formal Name</option>
        <option value="NATIVE_FAMILIAR">Native Familiar Name</option>
        <option value="NATIVE_FORMER">Native Former Name</option>
        <option value="NATIVE_LEGAL">Native Legal Name</option>
        <option value="NATIVE_OTHER">Native Other Name</option>
      </select>\`;
    document.getElementById("addNameVariation").insertAdjacentElement("beforebegin", row);
    row.querySelector("input").addEventListener("input", () => { nameSave.disabled = false; });
    row.querySelector("select").addEventListener("change", () => { nameSave.disabled = false; });
  });
  nameSave.addEventListener("click", () => {
    setTimeout(() => {
      const inputs = document.querySelectorAll(".businessEntityName");
      const last = inputs[inputs.length - 1];
      last.dataset.defaultvalue = last.value;
      last.classList.add("savedNameVariation");
      nameSave.disabled = true;
    }, 60);
  });

  const generalSave = document.getElementById("saveBusinessEntityButton");
  for (const sel of ["#webURL", 'select[name="businessEntity.emailDefaultStructure.id"]', ".highlight-textarea"]) {
    const el = document.querySelector(sel);
    el.addEventListener("input", () => { generalSave.disabled = false; });
    el.addEventListener("change", () => { generalSave.disabled = false; });
  }
  generalSave.addEventListener("click", () => {
    setTimeout(() => { generalSave.disabled = true; }, 60);
  });

  const sicSave = document.getElementById("saveSicIndustryPath");
  window.companySic = {
    add() {
      const addBtn = document.querySelector('[onclick="companySic.add()"]');
      const row = document.createElement("div");
      row.className = "sic-row";
      row.innerHTML = \`
        <input type="text" value="" class="input numberField" name="code" data-disabled-if-dnb-field="">
        <select class="input input_select" name="source" data-disabled-if-dnb-field="">
          <option value="-1" selected="selected"></option>
          <option value="1">Morningstar</option>
          <option value="2">PitchBook</option>
          <option value="3">SEC</option>
        </select>\`;
      addBtn.insertAdjacentElement("beforebegin", row);
      row.querySelector('input[name="code"]').addEventListener("input", () => { sicSave.disabled = false; });
      row.querySelector('select[name="source"]').addEventListener("change", () => { sicSave.disabled = false; });
    },
    save() {
      setTimeout(() => { sicSave.disabled = true; }, 60);
    }
  };
`;

const RESEARCH_JSON = {
  schemaVersion: "1.0",
  meta: { generatedAt: new Date().toISOString(), agent: "ScraperX/Rovo", inputFingerprint: null },
  profileIdentity: {
    companyName: "Aroma Grow Store", formalName: "Aroma Grow Store",
    domain: "aromagrowstore.com", pbId: "862926-85", entityId: null, sourceRtsUrl: null
  },
  businessEntity: {
    nameVariations: [
      { name: "Best Supply Partners LLC", type: "Legal Name", action: "addIfMissing", source: "https://www.aromagrowstore.com/about/", sourceDate: "09/09/2026", confidence: "high" }
    ],
    websiteAddresses: [{ value: "www.aromagrowstore.com", action: "addIfMissing", source: "www.aromagrowstore.com", confidence: "high" }],
    emailDefaultStructure: { value: "FirstInitialLastName@domain.com", action: "addIfMissing", source: "https://www.aromagrowstore.com/contact/", confidence: "medium" },
    researchNotes: [{ text: "Retailer of hydroponic and indoor gardening supplies, operating under parent company Best Supply Partners LLC.", action: "addIfMissing", source: "https://www.aromagrowstore.com/about/" }]
  },
  company: {
    briefDescription: { value: "Retailer of hydroponic and indoor gardening supplies for medical cannabis and home growers.", action: "addIfMissing", source: "https://www.aromagrowstore.com/about/", confidence: "high" },
    industries: [{ sector: "B2C", group: "Retail", code: "2.6.6", isPrimary: true, action: "addIfMissing", source: "https://www.aromagrowstore.com/" }],
    sicCodes: [{ code: "5261", classificationSource: "PitchBook", action: "addIfMissing", source: "https://www.osha.gov/sic-manual/5261" }]
  }
};

test("full panel -> execution plan -> workflow chain works in a real browser against the evidenced fixtures", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    page.on("dialog", (dialog) => dialog.accept());
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const body = [
      IDENTITY_HEADER,
      fixture("business-entity-name-variations.html"),
      fixture("business-entity-general.html"),
      fixture("company-sic.html"),
      `<script>${BEHAVIOR_SCRIPT}</script>`
    ].join("\n");
    await page.setContent(`<!doctype html><html><body>${body}</body></html>`);

    // The raw fixture (a real evidenced profile) already has an Email
    // Default Structure selected. Reset it to blank for a deterministic
    // starting state, same as tests/test-business-entity-general.mjs does
    // — otherwise the workflow correctly (and separately-testedly) refuses
    // to overwrite an existing value, which would hide the one thing this
    // test exists to prove: that the dropdown gets set at all.
    await page.evaluate(() => {
      document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').value = "-1";
    });

    for (const file of ASSISTANT_FILES) {
      await page.addScriptTag({ path: path.join(repo, file) });
    }

    await page.evaluate(() => {
      const host = document.createElement("section");
      host.id = "sxrts-assistant-root";
      document.documentElement.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" }); // production uses "closed"; "open" so this test can reach in
      globalThis.SXRTS.panel.mount(shadow);
    });

    const root = page.locator("#sxrts-assistant-root");
    await root.locator("#sxrts-response").fill(JSON.stringify(RESEARCH_JSON));
    await root.getByRole("button", { name: "Validate JSON" }).click();

    await root.locator(".status").first().locator("visible=true").waitFor({ timeout: 5000 }).catch(() => {});
    const validateStatus = await root.locator(".status").first().innerText();
    assert.match(validateStatus, /Valid \(schema 1\.0\)/, `expected a clean validation, got: ${validateStatus}`);

    const summaryBefore = await root.locator(".status").nth(1).innerText();
    assert.match(summaryBefore, /5 ready to publish/, `expected 5 ready-to-publish actions, got: ${summaryBefore}`);

    await root.getByRole("button", { name: "Publish selected to RTS" }).click();

    // Poll rather than a fixed sleep: waits only as long as actually needed.
    await page.waitForFunction(
      () => {
        const host = document.getElementById("sxrts-assistant-root");
        const statuses = host.shadowRoot.querySelectorAll(".status");
        return statuses[statuses.length - 1]?.textContent.includes("Published");
      },
      { timeout: 10000 }
    );
    const publishStatus = await root.locator(".status").nth(1).innerText();
    assert.match(publishStatus, /Published 5, skipped 0, failed 0/, `expected all 5 live fields to publish cleanly, got: ${publishStatus}`);

    // The real proof: read the actual RTS DOM state, not just the panel's
    // own claim about what happened.
    const domState = await page.evaluate(() => ({
      nameVariationValues: [...document.querySelectorAll(".businessEntityName")].map((el) => el.value),
      nameVariationTypes: [...document.querySelectorAll(".businessEntityNameType")].map((el) => el.selectedOptions[0].textContent),
      webURL: document.getElementById("webURL").value,
      emailDefaultStructure: document.querySelector('select[name="businessEntity.emailDefaultStructure.id"]').selectedOptions[0].textContent,
      researchNotes: document.querySelector(".highlight-textarea").textContent,
      sicCodes: [...document.querySelectorAll('input.numberField[name="code"]')].map((el) => el.value),
      sicSources: [...document.querySelectorAll('select[name="source"]')].map((el) => el.selectedOptions[0]?.textContent),
      allSaveButtonsDisabled: [
        document.getElementById("saveBusinessEntityNameVariation").disabled,
        document.getElementById("saveBusinessEntityButton").disabled,
        document.getElementById("saveSicIndustryPath").disabled
      ].every(Boolean)
    }));

    assert.ok(domState.nameVariationValues.includes("Best Supply Partners LLC"), "name variation was not actually written to the DOM");
    assert.ok(domState.nameVariationTypes.includes("Legal Name"), "name variation Type was not set correctly");
    assert.equal(domState.webURL, "www.aromagrowstore.com", "website address was not written correctly (RTS stores a bare host, not a full URL)");
    assert.equal(domState.emailDefaultStructure, "FirstInitialLastName@domain.com", "Email Default Structure dropdown did not land on the right option (this is the exact bug fixed in executionPlan.js)");
    assert.match(domState.researchNotes, /Retailer of hydroponic/, "research note was not appended");
    assert.ok(domState.sicCodes.includes("5261"), "SIC code was not added");
    assert.ok(domState.sicSources.includes("PitchBook"), "SIC source was not set correctly");
    assert.ok(domState.allSaveButtonsDisabled, "every Save button should have returned to disabled after a real save");

    assert.deepEqual(pageErrors, [], `unexpected uncaught page error(s): ${pageErrors.join("; ")}`);
  } finally {
    await browser.close();
  }
});
