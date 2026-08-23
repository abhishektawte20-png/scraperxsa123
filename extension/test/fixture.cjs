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
};
