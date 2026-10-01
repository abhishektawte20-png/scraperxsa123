// Runs the unit/DOM test suite and fails if it did not actually run tests.
// `node --test` exits 0 when it finds files but executes zero tests, which
// would let a broken test setup report green.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(path.join(root, "tests"))
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .map((name) => path.join("tests", name));

if (!files.length) {
  console.error("TEST SUITE INVALID — ZERO TESTS EXECUTED (no tests/test-*.mjs files were found).");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...files], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
child.on("close", (code) => {
  const read = (label) => Number((output.match(new RegExp(`^# ${label} (\\d+)`, "m")) || [])[1] ?? NaN);
  const [tests, pass, fail, skipped] = ["tests", "pass", "fail", "skipped"].map(read);
  console.log(`\nTest files discovered: ${files.length} | tests executed: ${tests} | passed: ${pass} | failed: ${fail} | skipped: ${skipped}`);
  if (!Number.isFinite(tests) || tests === 0) {
    console.error("TEST SUITE INVALID — ZERO TESTS EXECUTED");
    process.exit(1);
  }
  process.exit(code === 0 && fail === 0 ? 0 : 1);
});
