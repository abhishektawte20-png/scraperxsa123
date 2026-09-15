"use strict";

/*
 * Builds the ScraperX Rovo research prompt, mirroring the Conference
 * ScraperX prompt's style: exact required JSON shape + every enumerated
 * field's full supported-values list pulled directly from the registry
 * (single source of truth — never duplicated by hand), so Rovo cannot
 * invent a dropdown value.
 *
 * Scope: every field the schema currently supports EXCEPT
 * company.management, which is deliberately excluded by decision (not
 * an evidence gap) — see docs/evidence-checklist.md. Fields without a
 * wired-up workflow yet (e.g. company.sites) are still requested here
 * so the research only has to happen once; the panel reports them as
 * preview-only until their workflow lands.
 *
 * buildPrompt() is the per-run message. buildAgentInstructions() is the
 * SAME rules/shape/catalogs, framed as durable instructions meant to be
 * pasted into the Rovo custom agent's own configuration (not sent as a
 * one-off message) — see docs/rovo-agent-instructions.md and its header
 * comment for why this had to exist as a separate thing: a per-run
 * message alone was not enough to override the agent's own baked-in
 * prose report format.
 */
(() => {
  function catalogLabels(jsonPath, formKey) {
    const entry = globalThis.SXRTS.registry.getField(jsonPath);
    return entry?.form?.[formKey]?.options?.map((option) => option.label) ?? [];
  }

  function buildRulesAndShape() {
    const nameTypeOptions = catalogLabels("businessEntity.nameVariations", "typeDropdown");
    const emailStructureOptions = catalogLabels("businessEntity.emailDefaultStructure", "select");
    const sicSourceOptions = catalogLabels("company.sicCodes", "sourceDropdown");
    const siteTypeOptions = catalogLabels("company.sites", "siteType");
    const siteStatusOptions = catalogLabels("company.sites", "status");
    const countryOptions = catalogLabels("company.sites", "country");

    const requiredShape = {
      schemaVersion: "1.0",
      meta: { generatedAt: "ISO 8601 timestamp", agent: "ScraperX/Rovo", inputFingerprint: null },
      profileIdentity: {
        companyName: "string|null", formalName: "string|null", domain: "string|null",
        pbId: "string|null", entityId: null, sourceRtsUrl: null
      },
      businessEntity: {
        nameVariations: [{
          name: "string", type: "exact Name Type value from the list below",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip",
          source: "https://...|null", sourceDate: "MM/DD/YYYY|null", confidence: "high|medium|low|null"
        }],
        websiteAddresses: [{
          value: "bare domain (e.g. www.example.com) or full https URL",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip",
          source: "https://...|null", confidence: "high|medium|low|null"
        }],
        emailDefaultStructure: {
          value: "exact Email Default Structure value from the list below, or null",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip",
          source: "https://...|null", confidence: "high|medium|low|null"
        },
        researchNotes: [{
          text: "string", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null"
        }],
        socialMediaIdentifiers: [{
          network: "string (e.g. LinkedIn, Twitter, Facebook, Instagram)", handleOrUrl: "string",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip",
          source: "https://...|null", confidence: "high|medium|low|null"
        }]
      },
      company: {
        startDate: { value: "MM/DD/YYYY|null", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null", confidence: "high|medium|low|null" },
        briefDescription: { value: "string|null (concise, factual, no HTML)", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null", confidence: "high|medium|low|null" },
        fullDescription: { value: "string|null (concise, factual, no HTML)", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null", confidence: "high|medium|low|null" },
        keywords: [{ value: "string", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip" }],
        industries: [{
          sector: "string|null (e.g. B2B, B2C — free text, not yet catalog-validated)", group: "string|null", code: "string",
          isPrimary: "boolean|null", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null"
        }],
        verticals: [{ value: "string", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null" }],
        employeeHistory: [{ count: "number", asOfDate: "MM/DD/YYYY|null", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null" }],
        sicCodes: [{
          code: "string", classificationSource: "Morningstar|PitchBook|SEC|null",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null"
        }],
        naicsCodes: [{ code: "string", action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip" }],
        sites: [{
          siteName: "string|null", siteType: "exact Site Type value from the list below|null",
          address1: "string|null", address2: "string|null", city: "string|null",
          country: "exact Country value from the list below|null", state: "string|null (province/state, free text)",
          zip: "string|null", phone: "string|null", fax: "string|null", email: "string|null",
          status: "exact Site Status value from the list below|null",
          action: "addIfMissing|updateIfBlank|replaceAfterConfirmation|skip", source: "https://...|null"
        }]
      }
    };

    return [
      "Return exactly one valid JSON object and NOTHING else: no Markdown, no commentary, no section headers, no bullet points, no code fences. The entire response body must be parseable directly as JSON — if you find yourself writing a heading like \"SECTION 1\" or a bullet list, stop and convert it into the JSON shape below instead.",
      "Do not wrap any URL, domain, or value in markdown link syntax like \"[text](url)\" anywhere in the response — return plain, unformatted text and URLs only.",
      "Use null when a value cannot be verified. Use MM/DD/YYYY for dates.",
      "Every \"source\" field must be a fully qualified HTTPS URL to where you found that specific value, or null — never invent a citation.",
      "Do not invent a Name Type, Email Default Structure, SIC Source, Site Type, Site Status, or Country value that is not in the supported lists below — use null instead. Industries and Verticals are free text for now (not yet catalog-validated) — still be precise and cite a source.",
      "\"action\" must be one of: addIfMissing, updateIfBlank, replaceAfterConfirmation, skip. Default to addIfMissing for anything new. Only use replaceAfterConfirmation when you are confident an existing RTS value is wrong, and explain why in a research note.",
      "\"confidence\" must be one of: high, medium, low.",
      "This is schema v1.0. Omit a key entirely (rather than guessing) if nothing applies — do not include fields outside this shape. Do not research company management or leadership — that is intentionally out of scope for this tool.",
      "",
      "Common mistakes seen in real prior output — do not repeat these:",
      "1. WRONG: writing a value like \"Not found on the official website.\", \"N/A\", \"Unknown\", or any sentence explaining that something wasn't found. RIGHT: omit the field, or set its value to the JSON literal null.",
      "2. WRONG: \"domain\": \"[aromagrowstore.com](http://aromagrowstore.com/)\". RIGHT: \"domain\": \"aromagrowstore.com\" — plain text, no square brackets, no parentheses, no link formatting of any kind, even if your own reasoning involved clicking a rendered link.",
      "3. WRONG: \"source\": \"https://example.com/page/[\\\",](https://example.com/page/%22,)\" (a source URL with stray formatting fused onto it). RIGHT: \"source\": \"https://example.com/page/\" — a single, complete, plain URL with nothing appended after it.",
      "4. WRONG: starting the response with a heading like \"SECTION 1: Entity Details\", a bullet list, or any prose before the JSON. RIGHT: the response starts with \"{\" and contains nothing that is not part of the JSON object.",
      "5. WRONG: putting a bare domain (e.g. \"example.com\") in any \"source\" or \"sourceRtsUrl\" field. RIGHT: every \"source\" field is always a complete \"https://\" URL or null — bare domains are only ever valid for businessEntity.websiteAddresses[].value, nowhere else.",
      "6. WRONG: \"businessEntity.emailDefaultStructure\": null (a bare null for the whole field). RIGHT: either omit the key entirely, or use the full shape {\"value\": null, \"action\": \"skip\"} — this applies to every field shaped like an object (an \"envelope\": startDate, briefDescription, fullDescription, searchKeywords, emailDefaultStructure), not just this one.",
      "7. WRONG: \"http://\" in any \"source\" or website value. RIGHT: use \"https://\" — plain HTTP is almost never the real citation URL for a modern business website.",
      "8. WRONG: \"value\": \"null\" (the word null as literal text, in quotes). RIGHT: \"value\": null (the actual JSON literal, no quotes) — writing the word as a string is not the same thing and will be treated as real text to search a dropdown for.",
      "",
      "Required JSON shape:",
      JSON.stringify(requiredShape, null, 2),
      "",
      `Supported Name Variation Types (businessEntity.nameVariations[].type):\n- ${nameTypeOptions.join("\n- ")}`,
      "",
      `Supported Email Default Structure values (businessEntity.emailDefaultStructure.value):\n- ${emailStructureOptions.join("\n- ")}`,
      "",
      `Supported SIC Source values (company.sicCodes[].classificationSource):\n- ${sicSourceOptions.join("\n- ")}`,
      "",
      `Supported Site Type values (company.sites[].siteType):\n- ${siteTypeOptions.join("\n- ")}`,
      "",
      `Supported Site Status values (company.sites[].status):\n- ${siteStatusOptions.join("\n- ")}`,
      "",
      `Supported Country values (company.sites[].country):\n- ${countryOptions.join("\n- ")}`
    ].join("\n");
  }

  function buildPrompt({ companyName, domain } = {}) {
    return [
      "Research this company using the ScraperX process.",
      `Company name: ${companyName || ""}`,
      `Official website: ${domain || ""}`,
      "",
      buildRulesAndShape()
    ].join("\n");
  }

  function buildAgentInstructions() {
    return [
      "You are the ScraperX Company Research Agent for PitchBook RTS.",
      "",
      "Every time you are asked to research a company, you will be given a company name and an official website in the user's message, in this form:",
      "Company name: <name>",
      "Official website: <url>",
      "",
      "For every such request, follow the rules below exactly. These rules apply to every response, with no exceptions — including follow-up messages in the same conversation.",
      "",
      buildRulesAndShape()
    ].join("\n");
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.promptBuilder = { buildPrompt, buildAgentInstructions };
})();
