import { z } from "zod";

// Shared building blocks reused by every specialist agent.
// Per-agent schemas extend BaseResult; the full final-triage and per-stage
// schemas arrive with their phases (3-9).

// ARCHITECTURE.md §15 — evidence is first-class data.
// Optional fields are nullable (not .optional()): OpenAI structured-output
// strict mode requires every property in `required`, so absent values are null.
export const Evidence = z.object({
  type: z.enum(["code", "test", "documentation", "configuration", "execution", "deployment", "git"]),
  file: z.string().nullable(),
  symbol: z.string().nullable(),
  line: z.number().nullable(),
  claim: z.string(),
  detail: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

// ARCHITECTURE.md §14 — minimum every agent result carries.
export const BaseResult = z.object({
  verdict: z.string(),
  summary: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type BaseResult = z.infer<typeof BaseResult>;

// --- Intake stage (Phase 3) ---

// SPEC §4.3 — neutral technical representation of the report. Preserves all
// technical detail; claimed_severity is captured but isolated from downstream.
export const NormalizedReport = z.object({
  technical_claim: z.string(),
  claimed_root_cause: z.string(),
  affected_components: z.array(z.string()),
  claimed_attack_path: z.array(z.string()),
  attacker_capabilities: z.array(z.string()),
  victim_conditions: z.array(z.string()),
  claimed_preconditions: z.array(z.string()),
  technical_assumptions: z.array(z.string()),
  claimed_impact: z.string(),
  claimed_severity: z.string(), // ISOLATED — never forwarded to downstream agents
  code_references: z.array(z.string()),
  evidence_provided: z.array(z.string()),
  poc_provided: z.boolean(),
  poc_details: z.string(),
  unknowns: z.array(z.string()),
});
export type NormalizedReport = z.infer<typeof NormalizedReport>;

// Report-neutral view for downstream agents (drops reporter severity).
export type NeutralReport = Omit<NormalizedReport, "claimed_severity">;
export function neutralReport(r: NormalizedReport): NeutralReport {
  const { claimed_severity: _dropped, ...rest } = r;
  return rest;
}

// SPEC §4.2 — only report-relevant protocol context, not a generic summary.
export const ProtocolContext = z.object({
  relevant_components: z.array(z.string()),
  relevant_actors: z.array(z.string()),
  trust_boundaries: z.array(z.string()),
  relevant_permissions: z.array(z.string()),
  relevant_state: z.array(z.string()),
  key_invariants: z.array(z.string()),
  relevant_configuration: z.array(z.string()),
  relevant_execution_flows: z.array(z.string()),
  external_dependencies: z.array(z.string()),
});
export type ProtocolContext = z.infer<typeof ProtocolContext>;

// SPEC §4.4 — high-recall cheap filter. UNCERTAIN must continue to full triage.
export const SpamResult = z.object({
  verdict: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  reasoning: z.string(),
  evidence: z.array(Evidence),
});
export type SpamResult = z.infer<typeof SpamResult>;

// --- Root cause stage (Phase 4) ---

// SPEC §5.1 — independently verify whether the claimed faulty behavior exists.
export const RootCauseResult = z.object({
  verdict: z.enum(["VALID", "INVALID", "UNCERTAIN"]),
  summary: z.string(),
  affected_code: z.array(z.string()), // file:symbol:line
  reasoning: z.string(),
  contradicting_protections: z.array(z.string()), // guards that falsify the claim
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type RootCauseResult = z.infer<typeof RootCauseResult>;

// SPEC §5.2 — determine what the system is intended to do, independently.
export const IntendedBehaviorResult = z.object({
  intended_behavior: z.string(),
  deviates_from_intent: z.enum(["YES", "NO", "UNCLEAR"]),
  summary: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type IntendedBehaviorResult = z.infer<typeof IntendedBehaviorResult>;

// SPEC §5.3 — is there a genuine security-relevant root cause?
export const RootCauseVerdict = z.object({
  verdict: z.enum(["VALID", "INVALID", "UNCERTAIN"]),
  summary: z.string(),
  reasoning: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type RootCauseVerdict = z.infer<typeof RootCauseVerdict>;
