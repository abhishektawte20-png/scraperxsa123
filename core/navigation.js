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

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.navigation = { navigateToSection, navigateToCompany, navigateToBusinessEntity, ensureSectionOpen, findSectionBar };
})();
