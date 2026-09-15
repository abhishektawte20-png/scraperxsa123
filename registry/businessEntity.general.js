"use strict";

/*
 * Business Entity > Entity > "General" card: Website Address, Email
 * Default Structure, and Research Notes. Evidenced from Protocol DMC
 * Spain (PBID 862926-85) to share ONE Save button
 * (#saveBusinessEntityButton, data-test-id "be-page-save-changes-btn"),
 * separate from both the Entity Name/Type save and the Name Variations
 * save (#saveBusinessEntityNameVariation). Because they share one button,
 * these three are applied and saved together as one group.
 *
 * evidenceStatus: "ready" — confirmed by the researcher that this Save
 * button does return to disabled after a successful save, matching the
 * workflow's verification heuristic.
 */
(() => {
  const EMAIL_DEFAULT_STRUCTURE_OPTIONS = [
    { code: "1", label: "First.Last@domain.com" },
    { code: "2", label: "FirstInitialLastName@domain.com" },
    { code: "3", label: "FirstName@domain.com" },
    { code: "4", label: "First_Last@domain.com" },
    { code: "5", label: "LastName@domain.com" },
    { code: "6", label: "FirstName.MiddleInitial.LastName@domain.com" },
    { code: "7", label: "FirstAndLastInitial@domain.com" },
    { code: "8", label: "FirstMiddleAndLastInitial@domain.com" },
    { code: "9", label: "FirstInitial.LastName@domain.com" },
    { code: "10", label: "FirstNameLastName@domain.com" },
    { code: "11", label: "Familiar.Last@domain.com" },
    { code: "12", label: "FamiliarInitialLastName@domain.com" },
    { code: "13", label: "FamiliarName@domain.com" },
    { code: "14", label: "Familiar_Last@domain.com" },
    { code: "15", label: "FamiliarName.MiddleInitial.LastName@domain.com" },
    { code: "16", label: "FamiliarAndLastInitial@domain.com" },
    { code: "17", label: "FamiliarMiddleAndLastInitial@domain.com" },
    { code: "18", label: "FamiliarInitial.LastName@domain.com" },
    { code: "19", label: "FamiliarNameLastName@domain.com" },
    { code: "20", label: "FirstInitial.MiddleInitial.Last@domain.com" },
    { code: "21", label: "Familiar.LastInitial@domain.com" },
    { code: "22", label: "Familiar.MiddleLast@domain.com" },
    { code: "23", label: "Familiar_MiddleLast@domain.com" },
    { code: "24", label: "FirstName.LastInitial@domain.com" },
    { code: "25", label: "First.MiddleLast@domain.com" },
    { code: "26", label: "First_MiddleLast@domain.com" },
    { code: "27", label: "FirstMiddle.Last@domain.com" },
    { code: "28", label: "FirstMiddle_Last@domain.com" },
    { code: "29", label: "FirstMiddle-Last@domain.com" },
    { code: "30", label: "First-Last@domain.com" },
    { code: "31", label: "FamiliarMiddle.Last@domain.com" },
    { code: "32", label: "FamiliarMiddle_Last@domain.com" },
    { code: "33", label: "FamiliarMiddle-Last@domain.com" },
    { code: "34", label: "Familiar-MiddleLast@domain.com" },
    { code: "35", label: "Familiar-Last@domain.com" },
    { code: "36", label: "FirstInitial-LastInitial@domain.com" },
    { code: "37", label: "FirstInitial-LastName@domain.com" },
    { code: "38", label: "FirstInitialMiddleInitialLastInitial@domain.com" },
    { code: "39", label: "LastNameFirstInitial@domain.com" },
    { code: "40", label: "FirstNameLastInitial@domain.com" },
    { code: "41", label: "FirstInitialMiddleInitialLastName@domain.com" },
    { code: "42", label: "FirstName_LastInitial@domain.com" }
  ];

  const SAVE_BUTTON = { scopedTo: "Entity > General", candidates: ["#saveBusinessEntityButton"] };
  const VERIFICATION = { method: "disabledAfterSaveAndValueMatch" };

  const ENTRIES = [
    {
      key: "businessEntity.websiteAddresses",
      jsonPath: "businessEntity.websiteAddresses",
      area: "Business Entity",
      section: "Entity > General",
      controlKind: "text",
      form: { input: { candidates: ["#webURL"] } },
      saveButton: SAVE_BUTTON,
      verification: VERIFICATION,
      evidenceStatus: "ready",
      required: false
    },
    {
      key: "businessEntity.emailDefaultStructure",
      jsonPath: "businessEntity.emailDefaultStructure",
      area: "Business Entity",
      section: "Entity > General",
      controlKind: "nativeSelect",
      form: { select: { candidates: ['select[name="businessEntity.emailDefaultStructure.id"]'], options: EMAIL_DEFAULT_STRUCTURE_OPTIONS } },
      saveButton: SAVE_BUTTON,
      verification: VERIFICATION,
      evidenceStatus: "ready",
      required: false
    },
    {
      key: "businessEntity.researchNotes",
      jsonPath: "businessEntity.researchNotes",
      area: "Business Entity",
      section: "Entity > General",
      controlKind: "contentEditable",
      form: { editable: { candidates: [".highlight-textarea"] } },
      saveButton: SAVE_BUTTON,
      verification: VERIFICATION,
      duplicateRule: { normalize: "trim+collapseSpaces+lowercase", matchOn: ["text"] },
      evidenceStatus: "ready",
      required: false
    }
  ];

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.registryEntries = globalThis.SXRTS.registryEntries || [];
  globalThis.SXRTS.registryEntries.push(...ENTRIES);
})();
