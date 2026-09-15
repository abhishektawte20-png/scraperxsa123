"use strict";

/*
 * Safe adapter for a native <select> element only. Custom and searchable
 * dropdowns are NOT handled here — they require evidence of their real
 * markup (see docs/evidence-checklist.md) before an adapter can be written
 * for them without guessing.
 */
(() => {
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return globalThis.SXRTS.identityLock.normalizeText(value) || "";
  }

  function findExactOption(select, value) {
    const target = normalize(value);
    return Array.from(select.options).find((option) => normalize(option.textContent) === target || normalize(option.value) === target) || null;
  }

  async function selectNativeOption(select, value) {
    if (!(select instanceof HTMLSelectElement)) throw new Error("This control is not a native <select> element.");
    const option = findExactOption(select, value);
    if (!option) throw new Error(`"${value}" is not one of this dropdown's options.`);

    select.scrollIntoView({ block: "center", inline: "nearest" });
    select.focus({ preventScroll: true });
    await wait(0);

    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    descriptor.set.call(select, option.value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(0);
    select.blur();
    await wait(20);

    if (select.value !== option.value) {
      throw new Error(`The dropdown did not retain "${value}" after selection.`);
    }
  }

  function readSelectedOption(select) {
    return select?.selectedOptions?.[0]?.textContent?.trim() ?? "";
  }

  function verifySelection(select, expected) {
    return normalize(readSelectedOption(select)) === normalize(expected);
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.adapters = globalThis.SXRTS.adapters || {};
  globalThis.SXRTS.adapters.nativeSelect = { selectNativeOption, readSelectedOption, verifySelection, findExactOption };
})();
