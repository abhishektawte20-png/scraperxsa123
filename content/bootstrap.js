"use strict";

(() => {
  const ROOT_ID = "sxrts-assistant-root";
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.hidden = !existing.hidden;
    return;
  }

  const host = document.createElement("section");
  host.id = ROOT_ID;
  host.setAttribute("aria-label", "ScraperX RTS Profile Assistant");
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });
  globalThis.SXRTS.panel.mount(shadow);
})();
