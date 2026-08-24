// A stripped-down but structurally faithful Google results page.
module.exports = function serp(query) {
  const results = [
    { t: 'L&L Exhibition Management raises $4M to expand home shows',
      u: 'https://www.businesswire.com/news/home/2024/ll-exhibition',
      s: '12 Mar 2024 — L&L Exhibition Management raised a Series A round led by...' },
    { t: 'About Us | Home Show Center',
      u: 'https://www.homeshowcenter.com/about',
      s: 'L&L Exhibition Management was founded in 1998 and is headquartered in Denver, Colorado.' },
    { t: 'L&L Exhibition Management - Company Profile',
      u: 'https://pitchbook.com/profiles/company/12345-11',
      s: 'L&L Exhibition Management raised funding. Employee count and revenue estimates.' },
    { t: 'Unrelated trade show industry roundup',
      u: 'https://example.org/industry/news',
      s: 'General commentary on the exhibitions sector this quarter.' },
    { t: 'L&L Exhibition Management | LinkedIn',
      u: 'https://www.linkedin.com/company/ll-exhibition-management',
      s: 'L&L Exhibition Management | 240 followers. Denver-based producer of consumer home shows.' }
  ];
  return renderSerp(query, results);
};

function renderSerp(query, results) {
  return `<!doctype html><html><head><title>${query} - Google Search</title></head><body>
    <div id="result-stats">About 12,300 results<nobr> (0.42 seconds)</nobr></div>
    <div id="search"><div id="rso">
      ${results.map((r) => `
        <div class="g" data-hveid="CA" data-ved="2ahU">
          <div><div><a href="${r.u}"><br><h3>${r.t}</h3></a>
          <cite>${r.u.replace(/^https?:\/\//, '').split('/')[0]}</cite></div>
          <div class="VwiC3b"><span>${r.s}</span></div></div>
        </div>`).join('')}
    </div></div></body></html>`;
}

// Reproduces the exact ambiguity a researcher hit in production: a common
// company name colliding with an unrelated "Psypher Interactive", plus a
// negated funding claim that a plain keyword match would still flag.
module.exports.collisionSerp = function collisionSerp(query) {
  const results = [
    { t: 'Meet Psypher Interactive Walked into their stall at GAFX just to...',
      u: 'https://tracxn.com/Discover/Companies',
      s: '28 Jun 2026 — It operates as a Developer of AI-powered solutions for healthcare, finance, and other industries. Psypher AI has not raised any funding yet ...Read more' },
    { t: 'Psypher raises $8M Series A to expand AI healthcare platform',
      u: 'https://www.businesswire.com/news/psypher-series-a',
      s: '2 Aug 2026 — Psypher, the AI-powered healthcare and fintech startup, today announced it raised $8M in Series A funding led by...' },
    { t: 'Terms of Service',
      u: 'https://www.psypher.ai/terms',
      s: '24 Jul 2026 — All services, content, code, and branding are owned by Psypher AI. By submitting it, you grant us a license to use it.' }
  ];
  return renderSerp(query, results);
};

// The actual reported case, verbatim from the production screenshot: the
// real "Psypher" is an Indian streetwear brand at psypher.in; "Psypher AI"
// is an unrelated Kochi tech startup at psypher.ai — no excludeTerms
// configured, since the whole point is that this gets caught automatically.
module.exports.autoCollisionSerp = function autoCollisionSerp(query) {
  const results = [
    { t: 'About Psypher – Indian Streetwear Brand Story',
      u: 'https://www.psypher.in/pages/about-psypher',
      s: '28 Jun 2026 — PSYPHER emerged from a desire to translate artistic ideas, illustrations, photography, and other creative passions into wearable art. Founded in 2024, we\'re ...Read more' },
    { t: 'Psypher AI - 2026 Company Profile, Team & Competitors',
      u: 'https://tracxn.com/Discover/Companies/psypher-ai',
      s: '28 Jun 2026 — Psypher AI was founded in 2024. Where is Psypher AI located? Psypher AI is headquartered in Kochi, India. How many employees does Psypher AI ...Read more' },
    { t: 'Terms of Service',
      u: 'https://www.psypher.ai/terms',
      s: '24 Jul 2026 — All services, content, code, and branding are owned by Psypher AI and protected by international IP laws. ... By submitting it, you grant us a ...Read more' },
    { t: 'PSYPHER AI PRIVATE LIMITED - Company Profile',
      u: 'https://tracxn.com/Discover/Legal-Entities/India/psypher-ai-private-limited',
      s: '19 Jul 2026 — PSYPHER AI PRIVATE LIMITED is a Private Limited Company and was incorporated on Oct 14, 2024 in India. It is registered at Registrar of ...Read more' }
  ];
  return renderSerp(query, results);
};

// The bare-name probe SERP: the target streetwear brand plus the unrelated
// "Psypher AI", which is what makes the name ambiguous in the first place.
module.exports.probeSerp = function probeSerp(query) {
  const results = [
    { t: 'About Psypher – Indian Streetwear Brand Story',
      u: 'https://www.psypher.in/pages/about-psypher',
      s: 'PSYPHER emerged from a desire to translate artistic ideas into wearable art. Founded in 2024, based in Delhi.' },
    { t: 'Psypher streetwear drop',
      u: 'https://hypebeast.com/psypher',
      s: 'Psypher, based in Delhi, released a new capsule collection this month.' },
    { t: 'Psypher AI - 2026 Company Profile, Team & Competitors',
      u: 'https://tracxn.com/Discover/Companies/psypher-ai',
      s: 'Psypher AI was founded in 2024. Psypher AI is headquartered in Kochi, India.' },
    { t: 'Terms of Service',
      u: 'https://www.psypher.ai/terms',
      s: 'All services, content, code, and branding are owned by Psypher AI.' },
    { t: 'PSYPHER AI PRIVATE LIMITED - Company Profile',
      u: 'https://tracxn.com/Discover/Legal-Entities/India/psypher-ai',
      s: 'PSYPHER AI PRIVATE LIMITED was incorporated on Oct 14, 2024 in India.' }
  ];
  return renderSerp(query, results);
};

// An unambiguous company — the probe must stay silent for this one.
module.exports.soloSerp = function soloSerp(query) {
  const results = [
    { t: 'About Acme Robotics', u: 'https://www.acme.com/about',
      s: 'Acme Robotics, based in Boston, builds warehouse automation.' },
    { t: 'Acme Robotics raises $8M', u: 'https://www.businesswire.com/news/acme',
      s: 'Acme Robotics raised $8M in Series A funding this week.' }
  ];
  return renderSerp(query, results);
};
