"use strict";

/*
 * Team defaults for the ScraperX UI Automation Tool: the field mappings and
 * output rules every researcher gets from day one.
 *
 * To share: replace core/teamDefaults.js in the extension folder with this
 * file, reload the extension, then send the folder to the researchers.
 * Researchers can still change a mapping on their own browser; theirs wins
 * over the team default for that field.
 */
globalThis.SXRTS = globalThis.SXRTS || {};
globalThis.SXRTS.teamDefaults = {
  "format": "scraperx-team-defaults",
  "version": 1,
  "exportedAt": "2026-11-12T14:57:13.784Z",
  "extensionVersion": "0.31.0",
  "mappings": [
    {
      "binds": {
        "map": {
          "linkedIn": "handleOrUrl"
        },
        "path": "businessEntity.socialMediaIdentifiers"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "linkedIn",
          "kind": "text",
          "label": "LinkedIn",
          "selectors": [
            "#identifierText",
            "input.input"
          ]
        }
      ],
      "key": "businessEntitySocialMediaIdentifiers",
      "kind": "record",
      "label": "Social media identifiers",
      "openButton": {
        "selectors": [
          "#change",
          "input.btn.btn_small.btn_secondary",
          "input.btn",
          "input.btn_small",
          "input.btn_secondary",
          "input.w_100",
          "input.buttonView"
        ],
        "text": "New"
      },
      "rowBy": {
        "outKey": "network",
        "rowSelector": "div.row.align_items_center.identifier"
      },
      "saveButton": {
        "selectors": [
          "[data-test-id=\"social-media-change-tag-save-btn\"]",
          "#save",
          "input.btn.buttonSave_disabled",
          "input.btn",
          "input.buttonSave_disabled"
        ],
        "text": "Save Changes"
      },
      "updatedAt": "2026-11-09T09:51:48.888Z",
      "window": {
        "path": "/socialMedia/loadChangeIdentifier.html",
        "preSave": [
          {
            "selectors": [
              "#showExistingData",
              "input.mt_10.btn.btn_secondary",
              "input.mt_10",
              "input.btn",
              "input.btn_secondary",
              "input.btn_small"
            ],
            "text": "Show existing data"
          }
        ]
      }
    },
    {
      "binds": {
        "map": {
          "value": "value"
        },
        "path": "company.briefDescription"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "value",
          "kind": "text",
          "label": "value",
          "selectors": [
            "sx-after::textarea::Brief Description:",
            "#block_BRF_DESCR_CMP_DESCKEY > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div:nth-of-type(2) > textarea"
          ]
        }
      ],
      "key": "companyBriefDescription",
      "kind": "single",
      "label": "Brief description",
      "saveButton": {
        "selectors": [
          "[data-test-id=\"description-keywords-save-btn\"]",
          "button.button_main.button_primary-color.button_size-default",
          "button.button_primary-color"
        ],
        "text": "Save Changes"
      },
      "updatedAt": "2026-11-09T09:52:25.531Z"
    },
    {
      "binds": {
        "map": {
          "value": "value"
        },
        "path": "company.fullDescription"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "value",
          "kind": "text",
          "label": "value",
          "selectors": [
            "sx-after::textarea::Full Description:",
            "#block_FULL_DESCR_CMP_DESCKEY > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div:nth-of-type(2) > textarea"
          ]
        }
      ],
      "key": "companyFullDescription",
      "kind": "single",
      "label": "Full description",
      "saveButton": {
        "selectors": [
          "[data-test-id=\"description-keywords-save-btn\"]",
          "button.button_main.button_primary-color.button_size-default",
          "button.button_primary-color"
        ],
        "text": "Save Changes"
      },
      "updatedAt": "2026-11-09T09:52:47.773Z"
    },
    {
      "addButton": {
        "selectors": [
          "div.keywords__list"
        ],
        "text": ""
      },
      "binds": {
        "map": {
          "enterOrPasteKeywords": "value"
        },
        "path": "company.keywords"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "enterOrPasteKeywords",
          "kind": "text",
          "label": "Enter or paste keywords",
          "selectors": [
            "input[placeholder=\"Enter or paste keywords\"]",
            "input.keywords__input"
          ]
        }
      ],
      "key": "companyKeywords",
      "kind": "record",
      "label": "Keywords",
      "saveButton": {
        "selectors": [
          "[data-test-id=\"description-keywords-save-btn\"]",
          "button.button_main.button_primary-color.button_size-default",
          "button.button_primary-color"
        ],
        "text": "Save Changes"
      },
      "updatedAt": "2026-11-09T09:53:24.077Z"
    },
    {
      "binds": {
        "map": {
          "code": "code"
        },
        "path": "company.naicsCodes"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "code",
          "kind": "tree",
          "label": "NAICS code",
          "selectors": []
        }
      ],
      "key": "companyNaicsCodes",
      "kind": "record",
      "label": "NAICS codes",
      "openButton": {
        "selectors": [
          "[data-test-id=\"naics-add-button\"]"
        ],
        "text": "Add NAICS"
      },
      "saveButton": {
        "selectors": [
          "[data-test-id=\"naics-modal-save-button\"]"
        ],
        "text": "Save"
      },
      "tree": {
        "expander": {
          "selectors": [
            "input[name=\"tree-expander\"]",
            "input.checkbox-button__handler"
          ]
        },
        "kind": "naics",
        "leaf": {
          "selectors": [
            "input.radio-button__handler"
          ]
        },
        "sectionSave": {
          "selectors": [
            "[data-test-id=\"description-keywords-save-btn\"]",
            "button.button_main.button_primary-color.button_size-default",
            "button.button_primary-color"
          ],
          "text": "Save Changes"
        }
      },
      "updatedAt": "2026-11-09T09:54:31.449Z"
    },
    {
      "binds": {
        "map": {
          "value": "value"
        },
        "path": "extras.startDate"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "value",
          "kind": "text",
          "label": "Start Date",
          "selectors": [
            "sx-after::input::Start Date||1",
            "#startDate",
            "input[name=\"startDate\"]"
          ]
        }
      ],
      "key": "extrasStartDate",
      "kind": "single",
      "label": "Start date",
      "saveButton": {
        "selectors": [
          "[data-test-id=\"company-name-save-changes-btn\"]"
        ],
        "text": "Save changes"
      },
      "updatedAt": "2026-11-09T09:55:25.802Z"
    },
    {
      "binds": {
        "map": {
          "value": "value"
        },
        "path": "extras.industryCode"
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "value",
          "kind": "tree",
          "label": "Industry code",
          "selectors": []
        }
      ],
      "key": "extrasIndustryCode",
      "kind": "single",
      "label": "Industry code",
      "openButton": {
        "selectors": [
          "#containerIndustryGroup > div > div:nth-of-type(3) > input"
        ],
        "text": "Add/Edit Industry"
      },
      "saveButton": {
        "selectors": [
          "#saveIndustryButton",
          "input.btn.buttonSave",
          "input.btn",
          "input.buttonSave"
        ],
        "text": "Save Changes"
      },
      "updatedAt": "2026-11-09T09:57:07.190Z",
      "window": {
        "path": "/industryGroup/create.html",
        "preSave": [
          {
            "selectors": [
              "#saveIndustryButton",
              "input.btn.buttonSave",
              "input.btn",
              "input.buttonSave"
            ],
            "text": "Save Changes"
          }
        ],
        "tree": {
          "expander": {
            "selectors": [
              "[id^=\"industryControlGroup\"][id$=\"Expander\"]",
              "[id^=\"industryControlSegment\"][id$=\"Expander\"]"
            ],
            "text": ""
          },
          "leaf": {
            "baseKey": "DIV|controls_checkBox",
            "selectors": [
              "[id^=\"industryControlCode\"][id$=\"CheckBox\"]",
              "div.controls_checkBox"
            ],
            "text": ""
          }
        }
      }
    },
    {
      "binds": {
        "map": {
          "value": "value"
        },
        "path": "extras.employeeCount"
      },
      "closeButton": {
        "selectors": [
          "[data-testid=\"employeeCountsRtsUI::employeeHistorySection::deleteRowButton::1\"]"
        ],
        "text": ""
      },
      "description": "",
      "fields": [
        {
          "description": "",
          "key": "value",
          "kind": "text",
          "label": " ",
          "selectors": [
            "[data-testid=\"employeeCountsRtsUI::employeeHistorySection::employeeCount::0\"]",
            "input[name=\"records.0.employeeCount\"]"
          ]
        }
      ],
      "key": "extrasEmployeeCount",
      "kind": "single",
      "label": "Employee count",
      "openButton": {
        "selectors": [
          "form > div:nth-of-type(2) > div > div > button:nth-of-type(1)"
        ],
        "text": "Add New Employee Count"
      },
      "saveButton": {
        "selectors": [
          "div:nth-of-type(1) > form > div:nth-of-type(2) > div > button"
        ],
        "text": "Save EH"
      },
      "updatedAt": "2026-11-09T09:58:30.644Z"
    }
  ],
  "rules": []
};
