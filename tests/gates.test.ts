// Offline check: gate routing. Enumerates every verdict so a flipped gate is
// caught without spawning a real Codex agent. Run: node tests/gates.test.ts
import assert from "node:assert/strict";
import { spamStops, rootCauseStops, exploitabilityStops, isValidFinding } from "../src/gates.ts";

// Gate 1 — only FAIL stops.
assert.equal(spamStops("FAIL"), true);
assert.equal(spamStops("PASS"), false);
assert.equal(spamStops("UNCERTAIN"), false);

// Gate 2 — only INVALID stops.
assert.equal(rootCauseStops("INVALID"), true);
assert.equal(rootCauseStops("VALID"), false);
assert.equal(rootCauseStops("UNCERTAIN"), false);

// Gate 3 — only NOT_EXPLOITABLE stops.
assert.equal(exploitabilityStops("NOT_EXPLOITABLE"), true);
assert.equal(exploitabilityStops("EXPLOITABLE"), false);
assert.equal(exploitabilityStops("CONDITIONAL"), false);
assert.equal(exploitabilityStops("UNCERTAIN"), false);

// Mitigation runs only for valid findings.
assert.equal(isValidFinding("VALID"), true);
assert.equal(isValidFinding("PARTIALLY_VALID"), true);
assert.equal(isValidFinding("INVALID"), false);
assert.equal(isValidFinding("NEEDS_MORE_INFO"), false);

console.log("gates.test.ts: all checks passed");
