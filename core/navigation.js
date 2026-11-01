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

  // Opens every section of BOTH tabs (Business Entity and Company), so a control is never missing only because its
  // section was collapsed or its tab was not the one being shown. "Expand" is only pressed where it says Expand, so a
  // tab that is already open is never collapsed. The page is scrolled back to where it was.
  async function expandEverything() {
    const startY = window.scrollY || 0;
    let opened = 0;
    for (const name of ["Business Entity", "Company"]) {
      const button = Array.from(document.querySelectorAll("button.navigation__button")).find((btn) => btn.textContent.includes(name));
      if (!button) continue;
      button.click();
      await wait(300);
      if (await expandAll()) opened += 1;
    }
    if (!opened) await expandAll();
    try { window.scrollTo(0, startY); } catch { /* a page that cannot scroll simply stays */ }
    return opened;
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.navigation = { expandEverything, expandAll, findExpandControl, navigateToSection, navigateToCompany, navigateToBusinessEntity, ensureSectionOpen, findSectionBar };
})();
