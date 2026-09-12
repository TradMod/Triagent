import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, limit } from "./codex.ts";
import type { AgentRequest, AgentResult } from "./codex.ts";
import type { RunStore } from "./store.ts";
import {
  NormalizedReport,
  ProtocolContext,
  SpamResult,
  RootCauseResult,
  IntendedBehaviorResult,
  RootCauseVerdict,
  AttackPathResult,
  PreconditionsResult,
  PocResult,
  ExploitabilityResult,
  ImpactResult,
  LikelihoodResult,
  ContradictionResult,
  TargetedResult,
  EvidenceAuditResult,
  MainTriageDecision,
  MitigationResult,
  FinalTriageResult,
  neutralReport,
} from "./schemas.ts";
import { spamStops, rootCauseStops, exploitabilityStops, isValidFinding } from "./gates.ts";
import { buildFinal, stopFinal } from "./final.ts";

const PROMPTS_DIR = join(import.meta.dirname, "..", "prompts");
const loadPrompt = (name: string) => readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");

// ponytail: fixed caps; expose per-run config when eval shows it matters.
const CONCURRENCY = 4;
const MAX_TARGETED = 3; // cap targeted follow-up investigators per run (cost guard)

// Per-agent model/effort. Single default here; any spawn() call may override
// `model` / `modelReasoningEffort` (e.g. a cheaper model for intake/spam).
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_EFFORT = "high" as const;
const spawn = <T>(req: AgentRequest<T>): Promise<AgentResult<T>> =>
  runAgent({ model: DEFAULT_MODEL, modelReasoningEffort: DEFAULT_EFFORT, ...req });

export interface TriageOutcome {
  stopped?: "NORMALIZE_FAILED" | "SPAM" | "ROOT_CAUSE" | "EXPLOITABILITY";
  reason?: string;
}

// Validate and persist final.json. Every run ends here — including early stops.
function finish(store: RunStore, final: FinalTriageResult): void {
  const validated = FinalTriageResult.parse(final);
  store.saveJson("final", validated);
  store.logEvent({
    stage: "final",
    status: "INFO",
    note: `${validated.verdict} / ${validated.severity} / conf ${validated.confidence} / prio ${validated.priority}`,
  });
}

// Full gated pipeline: intake → spam → root cause → deep triage →
// exploitability → impact/likelihood → contradiction/evidence review → Main
// Triager. Always produces final.json.
// Later phases extend this past the gate.
export async function triage(store: RunStore, rawReport: string, repoPath: string): Promise<TriageOutcome> {
  const pool = limit(CONCURRENCY);

  // Independent intake agents run in parallel from the raw report.
  const [protocol, normalized] = await Promise.all([
    pool(() =>
      spawn({
        role: "protocol_context",
        prompt: loadPrompt("protocol_context"),
        repoPath,
        context: { report: rawReport },
        schema: ProtocolContext,
      }),
    ),
    pool(() =>
      spawn({
        role: "normalize_report",
        prompt: loadPrompt("normalize_report"),
        repoPath,
        context: { report: rawReport },
        schema: NormalizedReport,
      }),
    ),
  ]);
  store.saveResult("protocol_context", protocol);
  store.saveResult("normalized_report", normalized);

  // Normalized report is required to proceed; protocol context is best-effort.
  if (normalized.status !== "COMPLETED" || !normalized.output) {
    store.logEvent({ stage: "gate:normalize", status: "INFO", note: "normalization failed — cannot triage" });
    finish(store, stopFinal("NEEDS_MORE_INFO", `Report normalization failed: ${normalized.error ?? "unknown"}`, { confidence: 20 }));
    return { stopped: "NORMALIZE_FAILED", reason: normalized.error };
  }

  // Spam checker sees the neutral report (no reporter severity) + protocol context.
  const spam = await spawn({
    role: "spam_checker",
    prompt: loadPrompt("spam_checker"),
    repoPath,
    context: {
      report: neutralReport(normalized.output),
      protocol: protocol.output ?? null,
    },
    schema: SpamResult,
  });
  store.saveResult("spam", spam);

  // Gate 1 — only a confident FAIL stops; UNCERTAIN and PASS continue.
  if (spam.status === "COMPLETED" && spam.output && spamStops(spam.output.verdict)) {
    store.logEvent({ stage: "gate:spam", status: "INFO", note: `rejected: ${spam.output.reasoning}` });
    finish(store, stopFinal("INVALID", spam.output.reasoning));
    return { stopped: "SPAM", reason: spam.output.reasoning };
  }

  store.logEvent({ stage: "gate:spam", status: "INFO", note: `passed (${spam.output?.verdict ?? spam.status})` });

  // --- Root cause stage: Validator ‖ Intended Behavior → Judge (Gate 2) ---
  const neutral = neutralReport(normalized.output);
  const protocolCtx = protocol.output ?? null;

  const [validator, intended] = await Promise.all([
    pool(() =>
      spawn({
        role: "root_cause_validator",
        prompt: loadPrompt("root_cause_validator"),
        repoPath,
        context: { report: neutral, protocol: protocolCtx },
        schema: RootCauseResult,
      }),
    ),
    pool(() =>
      spawn({
        role: "intended_behavior",
        prompt: loadPrompt("intended_behavior"),
        repoPath,
        context: { report: neutral, protocol: protocolCtx },
        schema: IntendedBehaviorResult,
      }),
    ),
  ]);
  store.saveResult("root_cause_validator", validator);
  store.saveResult("intended_behavior", intended);

  const judge = await spawn({
    role: "root_cause_judge",
    prompt: loadPrompt("root_cause_judge"),
    repoPath,
    context: {
      report: neutral,
      validator: validator.output ?? null,
      intended_behavior: intended.output ?? null,
    },
    schema: RootCauseVerdict,
  });
  store.saveResult("root_cause", judge);

  // Gate 2 — only a confident INVALID stops. VALID and UNCERTAIN continue;
  // an unavailable verdict (judge failed) continues rather than rejecting.
  if (judge.status === "COMPLETED" && judge.output && rootCauseStops(judge.output.verdict)) {
    store.logEvent({ stage: "gate:root_cause", status: "INFO", note: `rejected: ${judge.output.reasoning}` });
    finish(store, stopFinal("INVALID", judge.output.reasoning, { confidence: judge.output.confidence }));
    return { stopped: "ROOT_CAUSE", reason: judge.output.reasoning };
  }
  store.logEvent({
    stage: "gate:root_cause",
    status: "INFO",
    note: `passed (${judge.output?.verdict ?? judge.status})`,
  });

  // --- Deep triage stage: Attack Path ‖ Preconditions ‖ PoC → Exploitability (Gate 3) ---
  const deepCtx = { report: neutral, protocol: protocolCtx, root_cause: judge.output ?? null };

  const [attackPath, preconditions, poc] = await Promise.all([
    pool(() =>
      spawn({
        role: "attack_path",
        prompt: loadPrompt("attack_path"),
        repoPath,
        context: deepCtx,
        schema: AttackPathResult,
      }),
    ),
    pool(() =>
      spawn({
        role: "preconditions",
        prompt: loadPrompt("preconditions"),
        repoPath,
        context: deepCtx,
        schema: PreconditionsResult,
      }),
    ),
    pool(() =>
      spawn({
        role: "poc_reproduction",
        prompt: loadPrompt("poc_reproduction"),
        repoPath,
        context: deepCtx,
        schema: PocResult,
      }),
    ),
  ]);
  store.saveResult("attack_path", attackPath);
  store.saveResult("preconditions", preconditions);
  store.saveResult("poc", poc);

  const exploitability = await spawn({
    role: "exploitability_judge",
    prompt: loadPrompt("exploitability_judge"),
    repoPath,
    context: {
      report: neutral,
      root_cause: judge.output ?? null,
      attack_path: attackPath.output ?? null,
      preconditions: preconditions.output ?? null,
      poc: poc.output ?? null,
    },
    schema: ExploitabilityResult,
  });
  store.saveResult("exploitability", exploitability);

  // Gate 3 — only a confident NOT_EXPLOITABLE stops. EXPLOITABLE / CONDITIONAL /
  // UNCERTAIN continue; a failed judge continues rather than rejecting.
  if (exploitability.status === "COMPLETED" && exploitability.output && exploitabilityStops(exploitability.output.verdict)) {
    store.logEvent({ stage: "gate:exploitability", status: "INFO", note: `rejected: ${exploitability.output.reasoning}` });
    finish(store, stopFinal("INVALID", exploitability.output.reasoning, { confidence: exploitability.output.confidence }));
    return { stopped: "EXPLOITABILITY", reason: exploitability.output.reasoning };
  }
  store.logEvent({
    stage: "gate:exploitability",
    status: "INFO",
    note: `passed (${exploitability.output?.verdict ?? exploitability.status})`,
  });

  // --- Impact ‖ Likelihood (parallel, no gate; feed the final triager) ---
  const assessCtx = {
    report: neutral,
    root_cause: judge.output ?? null,
    attack_path: attackPath.output ?? null,
    preconditions: preconditions.output ?? null,
    poc: poc.output ?? null,
    exploitability: exploitability.output ?? null,
  };

  const [impact, likelihood] = await Promise.all([
    pool(() =>
      spawn({
        role: "impact",
        prompt: loadPrompt("impact"),
        repoPath,
        context: assessCtx,
        schema: ImpactResult,
      }),
    ),
    pool(() =>
      spawn({
        role: "likelihood",
        prompt: loadPrompt("likelihood"),
        repoPath,
        context: assessCtx,
        schema: LikelihoodResult,
      }),
    ),
  ]);
  store.saveResult("impact", impact);
  store.saveResult("likelihood", likelihood);

  // --- Contradiction review → targeted investigations → evidence audit (Phase 7) ---
  const specialists = {
    report: neutral,
    root_cause: judge.output ?? null,
    attack_path: attackPath.output ?? null,
    preconditions: preconditions.output ?? null,
    poc: poc.output ?? null,
    exploitability: exploitability.output ?? null,
    impact: impact.output ?? null,
    likelihood: likelihood.output ?? null,
  };

  const contradiction = await spawn({
    role: "contradiction_reviewer",
    prompt: loadPrompt("contradiction_reviewer"),
    repoPath,
    context: specialists,
    schema: ContradictionResult,
  });
  store.saveResult("contradictions", contradiction);

  // Dynamically spawn a targeted investigator per recommended narrow question (capped).
  const questions = (contradiction.output?.recommended_investigations ?? []).slice(0, MAX_TARGETED);
  const targeted = await Promise.all(
    questions.map((question, i) =>
      pool(async () => {
        const res = await spawn({
          role: "targeted_investigator",
          prompt: loadPrompt("targeted_investigator"),
          repoPath,
          context: { question, report: neutral, protocol: protocolCtx },
          schema: TargetedResult,
        });
        store.saveResult(`targeted_${i + 1}`, res);
        return res;
      }),
    ),
  );

  const audit = await spawn({
    role: "evidence_auditor",
    prompt: loadPrompt("evidence_auditor"),
    repoPath,
    context: {
      ...specialists,
      contradictions: contradiction.output ?? null,
      targeted_investigations: targeted.map((t) => t.output ?? null),
    },
    schema: EvidenceAuditResult,
  });
  store.saveResult("evidence_audit", audit);

  // --- Main Triager: synthesize the final decision (Phase 8) ---
  const decision = await spawn({
    role: "main_triager",
    prompt: loadPrompt("main_triager"),
    repoPath,
    context: {
      ...specialists,
      contradictions: contradiction.output ?? null,
      targeted_investigations: targeted.map((t) => t.output ?? null),
      evidence_audit: audit.output ?? null,
    },
    schema: MainTriageDecision,
  });
  store.saveResult("main_triage_decision", decision);

  if (decision.status !== "COMPLETED" || !decision.output) {
    // Triager itself failed — surface uncertainty rather than a fabricated verdict.
    finish(store, stopFinal("NEEDS_MORE_INFO", `Main Triager failed: ${decision.error ?? "unknown"}`, { confidence: 20, priority: 3 }));
    return {};
  }

  // --- Mitigation: only for valid findings (Phase 9) ---
  let mitigation: MitigationResult | undefined;
  if (isValidFinding(decision.output.verdict)) {
    const mit = await spawn({
      role: "mitigation",
      prompt: loadPrompt("mitigation"),
      repoPath,
      context: {
        report: neutral,
        root_cause: judge.output ?? null,
        affected_code: validator.output?.affected_code ?? [],
        impact: impact.output ?? null,
        exploitability: exploitability.output ?? null,
      },
      schema: MitigationResult,
    });
    store.saveResult("mitigation", mit);
    mitigation = mit.output;
  }

  // Deterministically assemble final.json from the decision + specialist outputs.
  const final = buildFinal(
    decision.output,
    {
      validator: validator.output,
      intended: intended.output,
      judge: judge.output,
      attackPath: attackPath.output,
      preconditions: preconditions.output,
      poc: poc.output,
      impact: impact.output,
      likelihood: likelihood.output,
      contradiction: contradiction.output,
    },
    mitigation,
  );
  finish(store, final);
  return {};
}
