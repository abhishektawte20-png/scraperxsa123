"use strict";

/*
 * Runs in the RTS page itself (not the extension's isolated world), because only the page's own
 * window.alert / window.confirm can be answered. While the extension is running a publish
 * (the page root carries data-sx-run="1") a message box from RTS is answered at once and written down,
 * so nobody has to be at the computer to press OK. Outside a run nothing changes: the real box is shown.
 *
 * A confirm is answered OK, as a researcher would, except one that talks about deleting, removing or
 * discarding: that is answered Cancel and logged, because the extension never deletes anything.
 */
(() => {
  if (window.__sxDialogGuard) return;
  Object.defineProperty(window, "__sxDialogGuard", { value: true });
  const root = document.documentElement;
  const nativeAlert = window.alert;
  const nativeConfirm = window.confirm;
  const active = () => root.getAttribute("data-sx-run") === "1";
  const note = (kind, message, answer) => {
    let log = [];
    try { log = JSON.parse(root.getAttribute("data-sx-dialogs") || "[]"); } catch { log = []; }
    log.push({ kind, message: String(message ?? "").slice(0, 300), answer, at: Date.now() });
    root.setAttribute("data-sx-dialogs", JSON.stringify(log.slice(-30)));
  };
  window.alert = function (message) {
    if (!active()) return nativeAlert.apply(this, arguments);
    note("alert", message, "OK");
  };
  window.confirm = function (message) {
    if (!active()) return nativeConfirm.apply(this, arguments);
    const risky = /delet|remov|discard|erase|overwrit/i.test(String(message ?? ""));
    note("confirm", message, risky ? "Cancel" : "OK");
    return !risky;
  };
})();
