"use strict";
// The shipped Industry mapping (as researchers have it), alone, for the real-window test.
globalThis.SXRTS = globalThis.SXRTS || {};
globalThis.SXRTS.teamDefaults = {
  "format": "scraperx-team-defaults",
  "version": 1,
  "exportedAt": "2026-10-31T23:34:04.488Z",
  "extensionVersion": "0.22.2",
  "mappings": [
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
      "updatedAt": "2026-10-31T23:03:37.349Z",
      "window": {
        "path": "/industryGroup/create.html",
        "preSave": [],
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
    }
  ],
  "rules": []
};
