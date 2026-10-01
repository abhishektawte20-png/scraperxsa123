// Shared, fully compliant sample of the frozen Rovo output contract (Section 13).

export const NF = "Not found on the official website.";

export function sourced(value, url = "https://www.acme.com/about") {
  return { value, source_url: url };
}
function notFound() {
  return { value: NF, source_url: null };
}
function social(value, url) {
  return { value, source_url: url, note: null };
}
function socialNotFound() {
  return { value: NF, source_url: null, note: null };
}

export function validOutput() {
  return {
    extraction_status: "success",
    halt_reason: null,
    target_domain: "acme.com",
    extraction_date: "01 Oct 2026",
    domain_confirmation: { domain_provided: "acme.com", url_accessed: "https://www.acme.com/", tld_match_confirmed: true },
    not_for_profit_flag: { is_not_for_profit: false, note: "Not applicable" },
    entity_details: { entity_identified: true, official_website: sourced("https://www.acme.com/", "https://www.acme.com/") },
    funding: {
      timeline: [
        { sequence: 1, round_type: "Seed", date: "Sep 2017", amount: "$2M", investors: ["Acme Ventures"], source_1: "https://news.example.org/acme-seed", source_2: null, flag: null },
        { sequence: 2, round_type: "Series A", date: "Jun 2019", amount: "$15M", investors: ["Big Capital"], source_1: "https://news.example.org/acme-a", source_2: "https://bigcapital.com/portfolio/acme", flag: null }
      ],
      total_rounds_found: 2, total_confirmed_funding: "$17M",
      latest_round: { type: "Series A", date: "Jun 2019", amount: "$15M" },
      latest_investors: ["Big Capital"], backing_status: "VC-Backed", team_routing: "VC",
      routing_logic: "Latest round is Series A.", researcher_note: "Route to the VC team.",
      out_of_scope_rounds: [{ round_type: "No round identified under PB methodology", status: "Not applicable", date: "Not applicable", amount: "Not applicable", key_detail: "Not applicable", source_url: "https://www.acme.com/about", source_type: "Company website" }]
    },
    website_links: { pages_traversed: ["https://www.acme.com/about"], key_links: [{ label: "About", url: "https://www.acme.com/about" }] },
    name_variations: {
      formal_name: sourced("Acme"),
      legal_name: sourced("Acme Holdings Ltd", "https://www.acme.com/terms"),
      familiar_name: sourced("ACM"),
      former_name: notFound(),
      other_name_variations: [{ name: "艾克美", script: "Simplified Chinese", source_url: "https://www.acme.com/cn" }]
    },
    site_and_contact: {
      full_address: sourced("1 Main Street, Leeds, England", "https://www.acme.com/contact"),
      city: sourced("Leeds", "https://www.acme.com/contact"), state_or_region: sourced("England", "https://www.acme.com/contact"),
      country: sourced("United Kingdom", "https://www.acme.com/contact"), postcode: notFound(), phone: notFound(), fax: notFound(),
      site_email: sourced("info@acme.com", "https://www.acme.com/contact"),
      start_date: { value: "1997", source_url: "https://www.acme.com/about", corroborating_source_url: null, selection_logic: "Only one date found on the website." }
    },
    email_default_structure: { value: "First.Last@domain.com", source_url: "https://www.acme.com/team", sample_emails_observed: ["jane.doe@acme.com"] },
    social_media_identifiers: {
      linkedin: social("https://www.linkedin.com/company/acme", "https://www.acme.com/"),
      twitter_x: socialNotFound(), facebook: socialNotFound(), instagram: socialNotFound(), youtube: socialNotFound(), other: []
    },
    management: [{ full_name: "Jane Doe", titles: ["Chief Executive Officer", "Co-Founder"], is_founder: true, regional_title_equivalent: null, source_url: "https://www.acme.com/team" }],
    industry_classification: {
      buyer_type: { primary: "B2B", evidence_1: { quote: "For enterprise teams", source_url: "https://www.acme.com/" }, evidence_2: { quote: "Request a demo", source_url: "https://www.acme.com/pricing" } },
      primary_business_activity: "Develops fleet management software.", public_identity_test: "Most people would call this company a software company.",
      primary_industry_code: { number: "6.5.1", name: "Application Software" },
      primary_industry_sector: "Information Technology",
      evidence_for_primary_code: { quote: "Fleet software", source_url: "https://www.acme.com/" },
      logic: "Software is the product sold.", secondary_industry_codes: [], confidence: "High",
      confidence_rationale: "Explicit product pages.", additional_information_needed: null
    },
    verticals: { assigned: [], evaluated_not_assigned: [{ vertical_name: "SaaS", rejection_reason: "Perpetual licence sold." }], pages_reviewed: ["https://www.acme.com/"] },
    description: {
      classification_prefix: "Developer of", transition_phrase: "designed for",
      business_description: "Developer of fleet management software designed to oversee vehicle usage and coordinate operations.",
      full_description: "The company's platform offers features such as vehicle tracking, route monitoring, and maintenance scheduling, enabling fleet managers to oversee vehicle usage."
    },
    employee_count: { current: { count: "201-500", date: "01 Oct 2026 (website, assumed current)", source_url: "https://www.acme.com/about" }, history: [], notes: "Website states a range." },
    sic_codes: [
      { rank: 1, best_fit: true, code: "7372", title: "Prepackaged Software", relevance: "Sells packaged software.", source: "OSHA SIC Manual" },
      { rank: 2, best_fit: false, code: "7371", title: "Computer Programming Services", relevance: "Custom development.", source: "OSHA SIC Manual" }
    ],
    naics_codes: [{ rank: 1, best_fit: true, code: "511210", title: "Software Publishers", relevance: "Publishes software.", source: "2022 NAICS Manual" }],
    keywords: ["fleet management", "vehicle tracking", "route monitoring", "maintenance scheduling", "fleet managers", "telematics software", "driver safety", "fuel reporting", "asset tracking", "transport operators"],
    anc: { accepted_used: "AIGEN_SRX_V1_Y", rejected_not_used: "AIGEN_SRX_V1_N" }
  };
}

