"use strict";

/*
 * Execution-plan action state machine. Completion requires reaching
 * savedValueVerified — no other state, including editing or valueVerified,
 * may ever be reported to the researcher as "done".
 */
(() => {
  const STATES = [
    "pending", "validated", "navigating", "editing", "valueVerified",
    "awaitingSave", "saving", "saved", "savedValueVerified", "skipped", "failed"
  ];

  const TERMINAL_STATES = new Set(["savedValueVerified", "skipped", "failed"]);

  const ALLOWED_TRANSITIONS = {
    pending: ["validated", "skipped", "failed"],
    validated: ["navigating", "skipped", "failed"],
    navigating: ["editing", "failed"],
    editing: ["valueVerified", "failed"],
    valueVerified: ["awaitingSave", "failed"],
    awaitingSave: ["saving", "failed"],
    saving: ["saved", "failed"],
    saved: ["savedValueVerified", "failed"],
    savedValueVerified: [],
    skipped: [],
    failed: []
  };

  function transition(current, next) {
    if (!STATES.includes(current)) throw new Error(`Unknown state: ${current}`);
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`Illegal transition: ${current} -> ${next}.`);
    }
    return next;
  }

  function isTerminal(state) {
    return TERMINAL_STATES.has(state);
  }

  function isComplete(state) {
    return state === "savedValueVerified";
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.stateMachine = { STATES, ALLOWED_TRANSITIONS, transition, isTerminal, isComplete };
})();
