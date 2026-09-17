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

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.navigation = { navigateToSection, navigateToCompany, navigateToBusinessEntity };
})();
