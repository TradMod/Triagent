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

// --- Deep triage stage (Phase 5) ---

// SPEC §6.1 — full attacker-controlled execution path.
export const AttackPathResult = z.object({
  status: z.enum(["REACHABLE", "UNREACHABLE", "PARTIAL", "UNCERTAIN"]),
  summary: z.string(),
  attacker_capabilities: z.array(z.string()),
  steps: z.array(z.string()), // ordered execution path
  blockers: z.array(z.string()),
  weakest_step: z.string(),
  alternate_paths: z.array(z.string()),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type AttackPathResult = z.infer<typeof AttackPathResult>;

// SPEC §6.2 — every condition required for exploitation, independently verified.
export const Precondition = z.object({
  condition: z.string(),
  category: z.enum([
    "explicit",
    "implicit",
    "attacker",
    "victim",
    "protocol_state",
    "configuration",
    "environmental",
    "external",
  ]),
  status: z.enum(["SATISFIED", "UNSATISFIED", "CONDITIONAL", "UNKNOWN"]),
});
export const PreconditionsResult = z.object({
  summary: z.string(),
  conditions: z.array(Precondition),
  blocking: z.array(z.string()), // preconditions that block exploitation
  missing_from_report: z.array(z.string()), // preconditions the report omitted
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type PreconditionsResult = z.infer<typeof PreconditionsResult>;

// SPEC §6.3 — analyze the PoC and map it to real production behavior.
export const PocResult = z.object({
  provided: z.boolean(),
  status: z.enum(["WORKING", "BROKEN", "NOT_PROVIDED", "UNCERTAIN"]),
  production_equivalent: z.enum(["YES", "NO", "PARTIAL", "UNKNOWN"]),
  artificial_assumptions: z.array(z.string()), // mocks, impossible setup, test-only interfaces
  demonstrated_impact: z.string(),
  summary: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type PocResult = z.infer<typeof PocResult>;

// SPEC §7 — can the root cause produce a security-relevant exploit?
export const ExploitabilityResult = z.object({
  verdict: z.enum(["EXPLOITABLE", "NOT_EXPLOITABLE", "CONDITIONAL", "UNCERTAIN"]),
  summary: z.string(),
  reasoning: z.string(),
  conditions: z.array(z.string()), // conditions attached to a CONDITIONAL verdict
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type ExploitabilityResult = z.infer<typeof ExploitabilityResult>;

// --- Impact & likelihood stage (Phase 6) ---

// SPEC §8 — must separate three distinct impact concepts. Does NOT set severity.
export const ImpactResult = z.object({
  summary: z.string(),
  demonstrated: z.string(), // what has been concretely proven
  maximum_technical: z.string(), // max if all technically satisfiable conditions met
  production_exposure: z.string(), // what is currently exposed on the deployed system
  blast_radius: z.string(),
  assets_affected: z.array(z.string()),
  affected_scope: z.string(), // users / contracts / modules affected
  production_deployed: z.enum(["YES", "NO", "UNKNOWN"]),
  affected_version: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type ImpactResult = z.infer<typeof ImpactResult>;

// SPEC §9 — how realistically the validated exploit can occur. Does NOT set impact.
export const LikelihoodResult = z.object({
  summary: z.string(),
  attacker_access: z.string(),
  capital_requirement: z.string(),
  timing_requirement: z.string(),
  victim_interaction: z.string(),
  external_conditions: z.array(z.string()),
  repeatability: z.string(),
  reliability: z.string(),
  overall_likelihood: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type LikelihoodResult = z.infer<typeof LikelihoodResult>;

// --- Contradiction & evidence review stage (Phase 7) ---

// SPEC §10 — disagreement between specialist agents.
export const Contradiction = z.object({
  description: z.string(),
  agents: z.array(z.string()), // which specialists disagree
});
export const ContradictionResult = z.object({
  summary: z.string(),
  contradictions: z.array(Contradiction),
  unsupported_conclusions: z.array(z.string()),
  unresolved_questions: z.array(z.string()),
  recommended_investigations: z.array(z.string()), // narrow questions for targeted investigators
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type ContradictionResult = z.infer<typeof ContradictionResult>;

// SPEC §12 — one narrow follow-up question, answered from code/tests only.
export const TargetedResult = z.object({
  question: z.string(),
  answer: z.string(),
  verdict: z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "UNRESOLVED"]),
  summary: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type TargetedResult = z.infer<typeof TargetedResult>;

// SPEC §11 — ensure material conclusions are evidence-backed. Does NOT set severity.
export const AuditedClaim = z.object({
  claim: z.string(),
  supported: z.enum(["YES", "NO", "PARTIAL"]),
  issue: z.string(), // "" when supported
});
export const EvidenceFlag = z.object({
  type: z.enum([
    "unsupported_assertion",
    "hallucinated_behavior",
    "missing_code_reference",
    "weak_inference",
    "report_wording_only",
  ]),
  detail: z.string(),
});
export const EvidenceAuditResult = z.object({
  summary: z.string(),
  overall: z.enum(["SOUND", "WEAK", "UNSOUND"]),
  audited_claims: z.array(AuditedClaim),
  flags: z.array(EvidenceFlag),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type EvidenceAuditResult = z.infer<typeof EvidenceAuditResult>;

// --- Final decision (Phase 8) ---

// SPEC §13 — the Main Triager's synthesis. It decides ONLY these; the full
// final.json is assembled deterministically from specialist outputs (§4.1:
// it must not blindly redo specialist analysis). Reporter severity is never
// shown to it, so severity is determined independently.
export const MainTriageDecision = z.object({
  verdict: z.enum(["VALID", "INVALID", "PARTIALLY_VALID", "NEEDS_MORE_INFO"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]),
  confidence: z.number().min(0).max(100),
  priority: z.number().int().min(1).max(5),
  summary: z.string(),
  reasoning: z.string(),
  open_questions: z.array(z.string()),
  key_evidence: z.array(Evidence),
});
export type MainTriageDecision = z.infer<typeof MainTriageDecision>;

// SPEC §12 — remediation for a valid finding. Targets the validated root cause,
// not just the submitted PoC. Runs only for VALID / PARTIALLY_VALID findings.
export const MitigationResult = z.object({
  summary: z.string(),
  immediate: z.string(), // minimal safe change addressing the root cause
  long_term: z.array(z.string()), // tests, fuzzing, permission model, monitoring, etc.
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type MitigationResult = z.infer<typeof MitigationResult>;

// SPEC §14 — the assembled final output written to final.json. This is our own
// output contract (not an agent outputSchema), so .nullable() here is for data,
// not strict-mode.
export const FinalTriageResult = z.object({
  verdict: MainTriageDecision.shape.verdict,
  severity: MainTriageDecision.shape.severity,
  confidence: z.number().min(0).max(100),
  priority: z.number().int().min(1).max(5),
  summary: z.string(),
  root_cause: z.object({
    verdict: z.string(),
    description: z.string(),
    affected_code: z.array(z.string()),
    intended_behavior: z.string(),
    evidence: z.array(Evidence),
  }),
  attack_path: z.object({
    status: z.string(),
    steps: z.array(z.string()),
    blockers: z.array(z.string()),
    alternate_paths: z.array(z.string()),
  }),
  preconditions: z.object({
    required: z.array(z.string()),
    blocking: z.array(z.string()),
    missing_from_report: z.array(z.string()),
  }),
  poc: z.object({
    provided: z.boolean(),
    production_equivalent: z.string(),
    artificial_assumptions: z.array(z.string()),
    demonstrated_impact: z.string(),
  }),
  impact: z.object({
    demonstrated: z.string(),
    maximum_technical: z.string(),
    production_exposure: z.string(),
    blast_radius: z.string(),
  }),
  likelihood: z.object({
    rating: z.string(),
    reasoning: z.string(),
  }),
  production_status: z.object({
    affected: z.boolean().nullable(),
    version: z.string(),
    configuration: z.string(),
    evidence: z.array(Evidence),
  }),
  contradictions: z.array(z.string()),
  mitigation: z.object({
    immediate: z.string(),
    long_term: z.array(z.string()),
  }),
  open_questions: z.array(z.string()),
  evidence: z.array(Evidence),
});
export type FinalTriageResult = z.infer<typeof FinalTriageResult>;
