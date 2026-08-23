/**
 * ScraperX SERP agent.
 *
 * Runs on every Google results page, but stays completely silent unless the
 * background says this tab belongs to a run. When it does belong to one it
 * reads the page the way a researcher would — result count, the organic links,
 * their snippets — hands that back, and then paints the terms that mattered.
 */

(() => {
  'use strict';
  if (window.__scraperxSerpLoaded) return;
  window.__scraperxSerpLoaded = true;

  const BLOCK_PATHS = ['/sorry/', '/interstitial'];

  // ── page state ─────────────────────────────────────────────────────────────

  function isBlocked() {
    if (BLOCK_PATHS.some((p) => location.pathname.startsWith(p))) return 'captcha';
    if (document.querySelector('form#captcha-form, div#recaptcha, iframe[src*="recaptcha"]')) return 'captcha';
    const t = (document.title || '').toLowerCase();
    if (t.includes('unusual traffic') || t.includes('before you continue')) return 'captcha';
    if (location.hostname.startsWith('consent.')) return 'consent';
    return null;
  }

  function resultStats() {
    const el = document.querySelector('#result-stats, #resultStats');
    const text = el ? el.textContent.trim() : '';
    // "About 12,300 results (0.42 seconds)" -> 12300
    const m = text.replace(/[ ]/g, ' ').match(/([\d,.\s]{1,20})\s+result/i);
    let count = null;
    if (m) {
      const digits = m[1].replace(/[^\d]/g, '');
      if (digits) count = parseInt(digits, 10);
    }
    const zero = /did not match any documents|no results found/i.test(document.body.innerText.slice(0, 4000));
    if (count === null && zero) count = 0;
    return { text, count, zeroResults: zero };
  }

  // ── extraction ─────────────────────────────────────────────────────────────

  const SNIPPET_SELECTORS = [
    '[data-sncf]',
    '.VwiC3b',
    '.yXK7lf',
    '[data-content-feature="1"]',
    'div[style*="-webkit-line-clamp"]'
  ];

  function cleanUrl(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      // Google sometimes still wraps links in /url?q=
      if (u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || '';
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.toString();
    } catch { return ''; }
  }

  function isNoise(url) {
    if (!url) return true;
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      // Google's own surfaces (webcache, translate, maps, "people also ask")
      return /(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)googleusercontent\.com$/.test(h) || h === 'webcache.googleusercontent.com';
    } catch { return true; }
  }

  function containerFor(h3) {
    return (
      h3.closest('div.g') ||
      h3.closest('div[data-hveid][data-ved]') ||
      h3.closest('div[jscontroller]') ||
      h3.parentElement?.parentElement?.parentElement ||
      h3.parentElement
    );
  }

  function snippetFor(container, title) {
    if (!container) return '';
    for (const sel of SNIPPET_SELECTORS) {
      const el = container.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 20) return el.innerText.trim();
    }
    const text = (container.innerText || '').trim();
    return text.replace(title, '').trim().slice(0, 600);
  }

  function extractResults(limit) {
    const root = document.querySelector('#rso') || document.querySelector('#search') || document.body;
    const seen = new Set();
    const out = [];

    for (const h3 of root.querySelectorAll('h3')) {
      if (out.length >= limit) break;

      const anchor = h3.closest('a[href]') || h3.parentElement?.querySelector('a[href]');
      const url = cleanUrl(anchor && anchor.getAttribute('href'));
      if (isNoise(url) || seen.has(url)) continue;

      const container = containerFor(h3);
      // Skip "People also ask" / video carousels — they have no stable snippet
      // and the researchers never cite them.
      if (container && container.closest('[data-initq], [jsname="Cpkphb"]')) continue;

      const title = (h3.innerText || '').trim();
      if (!title) continue;

      seen.add(url);
      out.push({
        rank: out.length + 1,
        title,
        url,
        displayUrl: (container?.querySelector('cite')?.innerText || '').trim(),
        snippet: snippetFor(container, title)
      });
      if (container) container.dataset.sxIndex = String(out.length);
    }
    return out;
  }

  // ── highlighting ───────────────────────────────────────────────────────────

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function buildHighlightRegex(terms) {
    const parts = (terms || [])
      .filter((t) => t && String(t).trim().length > 1)
      .sort((a, b) => b.length - a.length)
      .map((t) => escapeRe(String(t).trim()).replace(/\\?\s+/g, '\\s+'));
    if (!parts.length) return null;
    return new RegExp(`(^|[^\\p{L}\\p{N}])(${parts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  }

  function highlightIn(root, regex) {
    if (!root || !regex) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|MARK)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.sx-bar')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    let count = 0;
    for (const node of targets) {
      const text = node.nodeValue;
      regex.lastIndex = 0;
      if (!regex.test(text)) continue;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = regex.exec(text)) !== null) {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        const mark = document.createElement('mark');
        mark.className = 'sx-hit';
        mark.textContent = text.slice(start, end);
        frag.appendChild(mark);
        last = end;
        count++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return count;
  }

  function decorate(scored) {
    for (const item of scored || []) {
      const container = document.querySelector(`[data-sx-index="${item.rank}"]`);
      if (!container || container.querySelector('.sx-badge')) continue;

      container.classList.add('sx-result', `sx-tier-${item.tier}`);

      const badge = document.createElement('div');
      badge.className = `sx-badge sx-badge-${item.tier}`;
      badge.innerHTML =
        `<span class="sx-score">${item.score}</span>` +
        `<span class="sx-tier">${item.tier}</span>` +
        `<span class="sx-why">${(item.reasons || []).slice(0, 3).join(' · ')}</span>`;
      container.prepend(badge);
    }
  }

  function banner(job, summary) {
    document.querySelector('.sx-bar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'sx-bar';
    bar.innerHTML =
      `<span class="sx-bar-tag">ScraperX</span>` +
      `<span class="sx-bar-name">${job.category} › ${job.name}</span>` +
      `<span class="sx-bar-stats">${summary.critical} critical · ${summary.strong} strong · ` +
      `${summary.total} scanned${summary.resultCount != null ? ` · ${summary.resultCount.toLocaleString()} results` : ''}</span>`;
    document.documentElement.appendChild(bar);
  }

  // ── report to background, then paint what it tells us ───────────────────────

  async function report() {
    const blocked = isBlocked();
    if (blocked) {
      chrome.runtime.sendMessage({ type: 'SX_SERP_BLOCKED', reason: blocked, url: location.href }).catch(() => {});
      return;
    }
    if (!location.pathname.startsWith('/search')) return;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'SX_SERP_READY',
        url: location.href,
        stats: resultStats(),
        // Extract generously; the background keeps only what it wants.
        results: extractResults(30)
      });
    } catch { return; }

    if (!response || !response.managed) return;
    if (response.highlight !== false) {
      const regex = buildHighlightRegex(response.terms || []);
      const root = document.querySelector('#rso') || document.querySelector('#search');
      highlightIn(root, regex);
      decorate(response.scored);
      if (response.job) banner(response.job, response.summary || { critical: 0, strong: 0, total: 0 });
    }
  }

  // Google renders progressively; give the DOM a beat, and retry once if the
  // results container wasn't there yet.
  const kick = () => {
    report();
    setTimeout(() => {
      if (!document.querySelector('[data-sx-index]') && !isBlocked()) report();
    }, 1200);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') kick();
  else document.addEventListener('DOMContentLoaded', kick, { once: true });

  // The panel can ask an already-open SERP to re-report (used by "Re-run this one").
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'SX_RESCAN') { report(); sendResponse({ ok: true }); }
    return false;
  });
})();
