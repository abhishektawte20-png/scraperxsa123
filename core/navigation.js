"use strict";

/*
 * Navigation helpers for switching between RTS sections (Business Entity, Company, etc.)
 * Uses text-based matching to find tab buttons since they have auto-generated class names.
 */
(() => {
  async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function navigateToSection(sectionText) {
    const button = Array.from(document.querySelectorAll("button.navigation__button"))
      .find((btn) => btn.textContent.includes(sectionText));

    if (!button) {
      return;
    }

    button.click();
    await wait(300);
    await expandAll();
  }

  async function navigateToCompany() {
    await navigateToSection("Company");
  }

  async function navigateToBusinessEntity() {
    await navigateToSection("Business Entity");
  }

  const norm = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();

  function isShown(node) {
    if (typeof node.checkVisibility === "function") return node.checkVisibility();
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.style?.display === "none") return false;
    }
    return true;
  }

  // The title bar of a collapsible RTS section: the first visible element whose
  // text is the title (a few characters of help icons are allowed after it).
  function findSectionBar(title) {
    const want = norm(title);
    return Array.from(document.querySelectorAll("div, span, a, button, h1, h2, h3, h4, li"))
      .find((node) => {
        const text = norm(node.textContent);
        return text.startsWith(want) && text.length <= want.length + 6 && isShown(node);
      }) || null;
  }

  // Opens a closed section only when the control that is needed is missing. If
  // clicking its bar does not bring the control into view, the click is undone
  // so a section that was already open is never left collapsed.
  async function ensureSectionOpen(isReady, titles) {
    if (isReady()) return true;
    for (const title of titles || []) {
      const bar = findSectionBar(title);
      if (!bar) continue;
      bar.click();
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if (isReady()) return true;
        await wait(50);
      }
      bar.click();
      await wait(150);
    }
    return Boolean(isReady());
  }

  // RTS has an "Expand" control at the top of a profile that opens every section of the tab.
  // Pressing it once means a field is not missed only because its section was collapsed.
  function findExpandControl() {
    const candidates = Array.from(document.querySelectorAll("a, button, span, div, input[type=button]"))
      .filter((node) => norm(node.textContent || node.value) === "expand" && isShown(node) && !node.closest("#sxrts-assistant-root"));
    return candidates.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length || (a.children.length - b.children.length))[0] || null;
  }

  async function expandAll() {
    const control = findExpandControl();
    if (!control) return false;
    control.click();
    await wait(500);
    return true;
  }

  // The two tabs of a profile. Only the tab being shown has its fields on screen, so each group of fields is
  // published with its own tab in front: "Business Entity" (names, website, email, notes, social media, start date) or
  // "Company" (industry, SIC, NAICS, keywords, descriptions, sites, employees).
  const TAB_MARKERS = {
    "Business Entity": ["#webURL", 'input[name="formalNameVariations"]', "#businessEntity\\.entityName"],
    Company: ["#containerIndustryGroup", 'input[placeholder="Enter or paste keywords"]']
  };
  const tabShown = (name) => (TAB_MARKERS[name] || []).some((selector) => { try { return Array.from(document.querySelectorAll(selector)).some(isShown); } catch { return false; } });
  const currentTab = () => ["Business Entity", "Company"].find(tabShown) || null;

  // Brings a tab to the front (only when it is not already) and opens its sections. Returns true when its fields are on screen.
  async function showTab(name) {
    if (tabShown(name)) return true;
    const button = Array.from(document.querySelectorAll("button.navigation__button")).find((btn) => btn.textContent.includes(name));
    if (!button) return false;
    button.click();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !tabShown(name)) await wait(60);
    await expandAll();
    return tabShown(name);
  }

  // Opens every section of BOTH tabs (Business Entity and Company), so a control is never missing only because its
  // section was collapsed. "Expand" is only pressed where it says Expand, so nothing already open is collapsed.
  // The tab that was in front at the start is put back in front at the end.
  async function expandEverything() {
    const start = currentTab();
    const startY = window.scrollY || 0;
    let opened = 0;
    for (const name of ["Business Entity", "Company"]) {
      const button = Array.from(document.querySelectorAll("button.navigation__button")).find((btn) => btn.textContent.includes(name));
      if (!button) continue;
      if (!tabShown(name)) { button.click(); await wait(300); }
      if (await expandAll()) opened += 1;
    }
    if (!opened) await expandAll();
    if (start && !tabShown(start)) await showTab(start);
    try { window.scrollTo(0, startY); } catch { /* a page that cannot scroll simply stays */ }
    return opened;
  }

  // What RTS says about edits: every "Last Edit By: NAME, MM/DD/YYYY ..." on the page. Read-only; used to show that nothing
  // was written before Publish and what changed after it.
  function readLastEdits() {
    const text = document.body?.innerText ?? document.body?.textContent ?? "";
    const found = [];
    const re = /Last Edit By:\s*([^,\n]+),\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi;
    for (let m; (m = re.exec(text));) found.push({ by: m[1].trim(), date: m[2] });
    return found;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.navigation = { readLastEdits, expandEverything, showTab, currentTab, expandAll, findExpandControl, navigateToSection, navigateToCompany, navigateToBusinessEntity, ensureSectionOpen, findSectionBar };
})();
