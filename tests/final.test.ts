// Offline check: final.json assembly from a decision + mocked specialist parts.
// No live Codex calls. Run: node tests/final.test.ts
import assert from "node:assert/strict";
import { buildFinal, stopFinal } from "../src/final.ts";
import { FinalTriageResult, type MainTriageDecision } from "../src/schemas.ts";

const decision: MainTriageDecision = {
  verdict: "VALID",
  severity: "HIGH",
  confidence: 82,
  priority: 4,
  summary: "Reentrancy allows draining the vault.",
  reasoning: "reachable path + satisfiable preconditions",
  open_questions: ["is the guard deployed?"],
  key_evidence: [{ type: "code", file: "Vault.sol", symbol: "withdraw", line: 42, claim: "no guard", detail: "external call before state update" }],
};

const final = buildFinal(decision, {
  judge: { verdict: "VALID", summary: "genuine defect", reasoning: "", evidence: [], unknowns: [], confidence: 90 },
  validator: {
    verdict: "VALID",
    summary: "exists",
    affected_code: ["Vault.sol:withdraw:42"],
    reasoning: "",
    contradicting_protections: [],
    evidence: [],
    unknowns: [],
    confidence: 90,
  },
  intended: { intended_behavior: "state update before external call", deviates_from_intent: "YES", summary: "", evidence: [], unknowns: [], confidence: 80 },
  preconditions: {
    summary: "",
    conditions: [{ condition: "attacker has an account", category: "attacker", status: "SATISFIED" }],
    blocking: [],
    missing_from_report: ["gas price"],
    evidence: [],
    unknowns: [],
    confidence: 70,
  },
  impact: {
    summary: "",
    demonstrated: "drained test vault",
    maximum_technical: "drain all funds",
    production_exposure: "mainnet vault holds 1200 ETH",
    blast_radius: "all depositors",
    assets_affected: ["ETH"],
    affected_scope: "all depositors",
    production_deployed: "YES",
    affected_version: "v1.2.0",
    evidence: [],
    unknowns: [],
    confidence: 75,
  },
  likelihood: {
    summary: "any attacker, one tx",
    attacker_access: "anonymous",
    capital_requirement: "gas only",
    timing_requirement: "none",
    victim_interaction: "none",
    external_conditions: [],
    repeatability: "repeatable",
    reliability: "high",
    overall_likelihood: "HIGH",
    evidence: [],
    unknowns: [],
    confidence: 80,
  },
  contradiction: {
    summary: "",
    contradictions: [{ description: "impact says all users, blast radius says one", agents: ["impact", "attack_path"] }],
    unsupported_conclusions: [],
    unresolved_questions: [],
    recommended_investigations: [],
    evidence: [],
    unknowns: [],
    confidence: 60,
  },
});

// Validates against the §14 contract.
FinalTriageResult.parse(final);

// Key deterministic mappings.
assert.equal(final.verdict, "VALID");
assert.equal(final.severity, "HIGH");
assert.equal(final.root_cause.intended_behavior, "state update before external call");
assert.equal(final.production_status.affected, true); // "YES" -> true
assert.equal(final.likelihood.rating, "HIGH");
assert.deepEqual(final.preconditions.required, ["attacker has an account [attacker: SATISFIED]"]);
assert.deepEqual(final.contradictions, ["impact says all users, blast radius says one"]);
assert.equal(final.mitigation.immediate, ""); // Phase 9 fills this
assert.deepEqual(final.open_questions, ["is the guard deployed?"]);

// Early-stop final still validates and maps production_deployed absence -> null.
const stopped = stopFinal("INVALID", "target does not exist");
FinalTriageResult.parse(stopped);
assert.equal(stopped.verdict, "INVALID");
assert.equal(stopped.production_status.affected, null);

console.log("final.test.ts: all checks passed");
