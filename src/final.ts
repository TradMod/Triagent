import type {
  MainTriageDecision,
  FinalTriageResult,
  RootCauseResult,
  IntendedBehaviorResult,
  RootCauseVerdict,
  AttackPathResult,
  PreconditionsResult,
  PocResult,
  ImpactResult,
  LikelihoodResult,
  ContradictionResult,
} from "./schemas.ts";

// Deterministic assembly of final.json from the Main Triager's decision plus the
// already-validated specialist outputs. No LLM re-synthesis of specialist data.

export interface SpecialistParts {
  validator?: RootCauseResult;
  intended?: IntendedBehaviorResult;
  judge?: RootCauseVerdict;
  attackPath?: AttackPathResult;
  preconditions?: PreconditionsResult;
  poc?: PocResult;
  impact?: ImpactResult;
  likelihood?: LikelihoodResult;
  contradiction?: ContradictionResult;
}

const deployed = (v: ImpactResult["production_deployed"] | undefined): boolean | null =>
  v === "YES" ? true : v === "NO" ? false : null;

export function buildFinal(decision: MainTriageDecision, p: SpecialistParts): FinalTriageResult {
  return {
    verdict: decision.verdict,
    severity: decision.severity,
    confidence: decision.confidence,
    priority: decision.priority,
    summary: decision.summary,
    root_cause: {
      verdict: p.judge?.verdict ?? p.validator?.verdict ?? "",
      description: p.judge?.summary ?? p.validator?.summary ?? "",
      affected_code: p.validator?.affected_code ?? [],
      intended_behavior: p.intended?.intended_behavior ?? "",
      evidence: p.judge?.evidence ?? p.validator?.evidence ?? [],
    },
    attack_path: {
      status: p.attackPath?.status ?? "",
      steps: p.attackPath?.steps ?? [],
      blockers: p.attackPath?.blockers ?? [],
      alternate_paths: p.attackPath?.alternate_paths ?? [],
    },
    preconditions: {
      required: (p.preconditions?.conditions ?? []).map((c) => `${c.condition} [${c.category}: ${c.status}]`),
      blocking: p.preconditions?.blocking ?? [],
      missing_from_report: p.preconditions?.missing_from_report ?? [],
    },
    poc: {
      provided: p.poc?.provided ?? false,
      production_equivalent: p.poc?.production_equivalent ?? "UNKNOWN",
      artificial_assumptions: p.poc?.artificial_assumptions ?? [],
      demonstrated_impact: p.poc?.demonstrated_impact ?? "",
    },
    impact: {
      demonstrated: p.impact?.demonstrated ?? "",
      maximum_technical: p.impact?.maximum_technical ?? "",
      production_exposure: p.impact?.production_exposure ?? "",
      blast_radius: p.impact?.blast_radius ?? "",
    },
    likelihood: {
      rating: p.likelihood?.overall_likelihood ?? "",
      reasoning: p.likelihood?.summary ?? "",
    },
    production_status: {
      affected: deployed(p.impact?.production_deployed),
      version: p.impact?.affected_version ?? "",
      configuration: "",
      evidence: p.impact?.evidence ?? [],
    },
    contradictions: (p.contradiction?.contradictions ?? []).map((c) => c.description),
    mitigation: { immediate: "", long_term: [] }, // filled by Phase 9 for valid findings
    open_questions: decision.open_questions,
    evidence: decision.key_evidence,
  };
}

// Minimal final.json for an early pipeline stop (reject / cannot-triage). No
// Main Triager call — the stop reason is the decision.
export function stopFinal(
  verdict: FinalTriageResult["verdict"],
  summary: string,
  opts: { confidence?: number; priority?: 1 | 2 | 3 | 4 | 5 } = {},
): FinalTriageResult {
  return buildFinal(
    {
      verdict,
      severity: "INFORMATIONAL",
      confidence: opts.confidence ?? 60,
      priority: opts.priority ?? 1,
      summary,
      reasoning: summary,
      open_questions: [],
      key_evidence: [],
    },
    {},
  );
}
