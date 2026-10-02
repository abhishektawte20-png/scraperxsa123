"use strict";

/*
 * Small shared UI helpers: hover help ("tips") and the product credit. A tip is
 * any element carrying data-tip="..."; one floating bubble is positioned next
 * to it in JavaScript and clamped to the viewport, so it is never clipped by
 * the panel's own scroll area.
 */
(() => {
  const CREDIT = "Developed by Abhishek Tawte";

  const TIP_CSS = `
    .help { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-left: 5px;
      border-radius: 50%; background: #dbe6f3; color: #124a80; font: 700 10px/1 -apple-system, "Segoe UI", sans-serif; cursor: help; vertical-align: middle; }
    .help:hover, .help:focus { background: #124a80; color: #fff; outline: none; }
    .sx-tip { position: fixed; z-index: 2147483649; max-width: 270px; padding: 9px 11px; border-radius: 8px; pointer-events: none;
      background: #0b2038; color: #f2f6fb; font: 400 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 24px rgba(5, 15, 30, .35); opacity: 0; transition: opacity .1s; white-space: pre-line; }
    .sx-tip.show { opacity: 1; }
  `;

  function tip(node, text) {
    node.setAttribute("data-tip", text);
    return node;
  }

  function help(text) {
    const mark = document.createElement("span");
    mark.className = "help";
    mark.textContent = "?";
    mark.tabIndex = 0;
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", text);
    return tip(mark, text);
  }

  function installTips(shadow) {
    if (shadow.__sxTips) return;
    shadow.__sxTips = true;
    const bubble = document.createElement("div");
    bubble.className = "sx-tip";
    bubble.setAttribute("role", "tooltip");
    shadow.appendChild(bubble);

    const show = (target) => {
      // Browsers cap z-index at 2147483647, the same as the panel, so the bubble
      // must be the last child to be drawn on top.
      if (shadow.lastChild !== bubble) shadow.appendChild(bubble);
      bubble.textContent = target.getAttribute("data-tip");
      bubble.classList.add("show");
      const rect = target.getBoundingClientRect();
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const vw = window.innerWidth || 1024;
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), Math.max(8, vw - width - 8));
      const above = rect.top - height - 10;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${above >= 8 ? above : rect.bottom + 10}px`;
    };
    const hide = () => bubble.classList.remove("show");
    const find = (event) => (event.target instanceof Element ? event.target.closest("[data-tip]") : null);

    shadow.addEventListener("mouseover", (event) => { const t = find(event); if (t) show(t); });
    shadow.addEventListener("mouseout", (event) => { if (find(event)) hide(); });
    shadow.addEventListener("focusin", (event) => { const t = find(event); if (t) show(t); });
    shadow.addEventListener("focusout", hide);
    shadow.addEventListener("click", hide);
  }

  function version() {
    try {
      return globalThis.chrome?.runtime?.getManifest?.().version ?? "";
    } catch {
      return "";
    }
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.ui = { CREDIT, TIP_CSS, tip, help, installTips, version };
})();
