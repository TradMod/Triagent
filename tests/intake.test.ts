// Offline check: reporter severity is isolated from the downstream view.
// Run: node tests/intake.test.ts
import assert from "node:assert/strict";
import { neutralReport, type NormalizedReport } from "../src/schemas.ts";

const full: NormalizedReport = {
  technical_claim: "reentrancy in withdraw",
  claimed_root_cause: "no reentrancy guard",
  affected_components: ["Vault"],
  claimed_attack_path: ["call withdraw", "reenter"],
  attacker_capabilities: ["any EOA"],
  victim_conditions: [],
  claimed_preconditions: [],
  technical_assumptions: [],
  claimed_impact: "drain vault",
  claimed_severity: "CRITICAL",
  code_references: ["Vault.sol:withdraw"],
  evidence_provided: [],
  poc_provided: true,
  poc_details: "foundry test",
  unknowns: [],
};

const neutral = neutralReport(full);

// Severity must be gone...
assert.equal("claimed_severity" in neutral, false, "claimed_severity leaked downstream");
// ...and every other technical field must survive.
for (const k of Object.keys(full)) {
  if (k === "claimed_severity") continue;
  assert.deepEqual((neutral as Record<string, unknown>)[k], (full as Record<string, unknown>)[k], `dropped field ${k}`);
}

console.log("intake.test.ts: all checks passed");
