"use strict";

/*
 * Plain-language JSON problems and the few repairs that are safe.
 *
 * explain() turns the browser's parse error into a sentence with the line,
 * column and the text around it. repair() fixes only mistakes whose intended
 * meaning is never in doubt (a comma before a closing bracket, a raw line break
 * inside a text value, curly quote marks used as quotes, a comment, True/False)
 * and only reports success when the result really parses. Anything that would
 * need a guess (a quote mark inside a text value, a reply that is cut off) is
 * left alone so the researcher can ask the agent again.
 */
(() => {
  function locate(text, pos) {
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    const column = pos - (before.lastIndexOf("\n") + 1) + 1;
    return { line, column };
  }

  function snippet(text, pos) {
    const start = Math.max(0, pos - 40);
    const end = Math.min(text.length, pos + 40);
    const piece = text.slice(start, end).replace(/\s+/g, " ");
    const lead = text.slice(start, pos).replace(/\s+/g, " ").length;
    return { near: `${start > 0 ? "…" : ""}${piece}${end < text.length ? "…" : ""}`, caret: " ".repeat(lead + (start > 0 ? 1 : 0)) + "^" };
  }

  function plainReason(message, text, pos) {
    const m = String(message);
    // The error is at the very end of the text: nothing is wrong yet, it just stops.
    if (pos !== null && pos >= text.trimEnd().length && !/Unterminated string/i.test(m)) return "The JSON stops too early, as if the agent's reply was cut off. A bracket or quote mark is still open.";
    if (/Unexpected end of JSON/i.test(m)) return "The JSON stops too early, as if the agent's reply was cut off. A bracket or quote mark is still open.";
    if (/Unterminated string/i.test(m)) return "A text value was opened with a quote mark but never closed.";
    if (/Bad control character/i.test(m)) return "A text value contains a raw line break or tab. Inside a text value it must be written as \\n or \\t.";
    if (/Bad (escaped|Unicode escape)/i.test(m)) return "A text value contains a backslash that is not a valid escape (use \\\\ for a backslash).";
    if (/Expected double-quoted property name/i.test(m)) return "A key is not in double quotes, or there is an extra comma just before a closing bracket.";
    if (/Expected ',' or/i.test(m) || /Expected ':'/i.test(m)) return "Something is missing between two items: usually a comma, or a quote mark inside a text value that was not escaped (\\\").";
    const token = /Unexpected token (.+?)(?: in JSON| at position|, )/.exec(m);
    if (token) return `Unexpected character ${token[1]}. This is usually a missing or extra comma, or a quote mark inside a text value that was not escaped.`;
    if (/Unexpected non-whitespace/i.test(m)) return "There is extra text after the end of the JSON object.";
    return m;
  }

  // { reason, line, column, near, caret, text } for a JSON.parse failure.
  function explain(error, text) {
    const message = String(error?.message ?? error ?? "");
    let pos = null;
    const at = /position (\d+)/.exec(message);
    if (at) pos = Number(at[1]);
    else if (/Unexpected end/i.test(message)) pos = text.length;
    const reason = plainReason(message, text, pos);
    if (pos === null) return { reason, line: null, column: null, near: "", caret: "", text: reason };
    const where = locate(text, Math.min(pos, text.length));
    const view = snippet(text, Math.min(pos, text.length));
    return { reason, ...where, ...view, text: `Line ${where.line}, column ${where.column}: ${reason}` };
  }

  const CURLY = { "“": "”", "”": "”", "„": "”" };
  const PYTHON = { True: "true", False: "false", None: "null" };

  // { ok, text, fixes: [{ code, line, message }] }
  function repair(input) {
    const src = String(input ?? "");
    const fixes = [];
    const note = (code, pos, message) => fixes.push({ code, line: locate(src, pos).line, message });
    let out = "";
    let i = 0;
    let quote = null; // the character that opened the current text value
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") {
          const n = src[i + 1];
          if (n === "'") { out += "'"; note("ESCAPED_APOSTROPHE", i, "removed a backslash before an apostrophe"); i += 2; continue; }
          out += c + (n ?? ""); i += 2; continue;
        }
        if (c === quote || (quote === "”" && CURLY[c])) { out += '"'; quote = null; i++; continue; }
        if (c === '"') return { ok: false, text: src, fixes: [] }; // a quote inside a curly-quoted value: a guess would be needed
        if (c === "\n") { out += "\\n"; note("RAW_NEWLINE", i, "wrote a raw line break inside a text value as \\n"); i++; continue; }
        if (c === "\r") { if (src[i + 1] !== "\n") out += "\\n"; i++; continue; }
        if (c === "\t") { out += "\\t"; note("RAW_TAB", i, "wrote a raw tab inside a text value as \\t"); i++; continue; }
        out += c; i++; continue;
      }
      if (c === '"') { quote = '"'; out += c; i++; continue; }
      if (CURLY[c]) { quote = "”"; out += '"'; note("CURLY_QUOTES", i, "replaced curly quote marks with straight ones"); i++; continue; }
      if (c === "/" && src[i + 1] === "/") { const end = src.indexOf("\n", i); note("COMMENT", i, "removed a // comment"); i = end === -1 ? src.length : end; continue; }
      if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end === -1) return { ok: false, text: src, fixes: [] }; note("COMMENT", i, "removed a /* */ comment"); i = end + 2; continue; }
      if (c === ",") {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === "}" || src[j] === "]") { note("TRAILING_COMMA", i, "removed a comma before a closing bracket"); i++; continue; }
      }
      if (/[A-Za-z]/.test(c) && (i === 0 || !/[A-Za-z0-9_$]/.test(src[i - 1]))) {
        const word = /^[A-Za-z]+/.exec(src.slice(i))[0];
        if (PYTHON[word]) { out += PYTHON[word]; note("PYTHON_LITERAL", i, `changed ${word} to ${PYTHON[word]}`); i += word.length; continue; }
      }
      if (c === "﻿" || c === "​" || c === "‌" || c === "‍" || c === "⁠") { note("INVISIBLE", i, "removed an invisible character"); i++; continue; }
      if (c === " ") { out += " "; note("NBSP", i, "replaced a non-breaking space"); i++; continue; }
      out += c; i++;
    }
    if (quote) return { ok: false, text: src, fixes: [] };
    try { JSON.parse(out); } catch { return { ok: false, text: src, fixes: [] }; }
    return { ok: true, text: out, fixes };
  }

  // "removed 2 trailing commas (lines 12, 40)": one sentence per kind of fix.
  function summarize(fixes) {
    const byCode = new Map();
    for (const fix of fixes) {
      if (!byCode.has(fix.code)) byCode.set(fix.code, { message: fix.message, lines: [] });
      byCode.get(fix.code).lines.push(fix.line);
    }
    return Array.from(byCode.values()).map(({ message, lines }) => {
      const unique = Array.from(new Set(lines));
      return `${message}${lines.length > 1 ? ` (${lines.length} times)` : ""}, line${unique.length > 1 ? "s" : ""} ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? "…" : ""}`;
    });
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.jsonRepair = { explain, repair, summarize, locate };
})();
