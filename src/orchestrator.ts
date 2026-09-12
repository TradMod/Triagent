import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, limit } from "./codex.ts";
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
  neutralReport,
} from "./schemas.ts";
import { spamStops, rootCauseStops, exploitabilityStops } from "./gates.ts";

const PROMPTS_DIR = join(import.meta.dirname, "..", "prompts");
const loadPrompt = (name: string) => readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");

// ponytail: fixed cap; expose per-run config when eval shows it matters.
const CONCURRENCY = 4;

export interface TriageOutcome {
  stopped?: "NORMALIZE_FAILED" | "SPAM" | "ROOT_CAUSE" | "EXPLOITABILITY";
  reason?: string;
}

// Phase 3: intake (Protocol Context ‖ Report Normalizer) → Spam gate.
// Later phases extend this past the gate.
export async function triage(store: RunStore, rawReport: string, repoPath: string): Promise<TriageOutcome> {
  const pool = limit(CONCURRENCY);

  // Independent intake agents run in parallel from the raw report.
  const [protocol, normalized] = await Promise.all([
    pool(() =>
      runAgent({
        role: "protocol_context",
        prompt: loadPrompt("protocol_context"),
        repoPath,
        context: { report: rawReport },
        schema: ProtocolContext,
      }),
    ),
    pool(() =>
      runAgent({
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
    return { stopped: "NORMALIZE_FAILED", reason: normalized.error };
  }

  // Spam checker sees the neutral report (no reporter severity) + protocol context.
  const spam = await runAgent({
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
    return { stopped: "SPAM", reason: spam.output.reasoning };
  }

  store.logEvent({ stage: "gate:spam", status: "INFO", note: `passed (${spam.output?.verdict ?? spam.status})` });

  // --- Root cause stage: Validator ‖ Intended Behavior → Judge (Gate 2) ---
  const neutral = neutralReport(normalized.output);
  const protocolCtx = protocol.output ?? null;

  const [validator, intended] = await Promise.all([
    pool(() =>
      runAgent({
        role: "root_cause_validator",
        prompt: loadPrompt("root_cause_validator"),
        repoPath,
        context: { report: neutral, protocol: protocolCtx },
        schema: RootCauseResult,
      }),
    ),
    pool(() =>
      runAgent({
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

  const judge = await runAgent({
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
      runAgent({
        role: "attack_path",
        prompt: loadPrompt("attack_path"),
        repoPath,
        context: deepCtx,
        schema: AttackPathResult,
      }),
    ),
    pool(() =>
      runAgent({
        role: "preconditions",
        prompt: loadPrompt("preconditions"),
        repoPath,
        context: deepCtx,
        schema: PreconditionsResult,
      }),
    ),
    pool(() =>
      runAgent({
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

  const exploitability = await runAgent({
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
      runAgent({
        role: "impact",
        prompt: loadPrompt("impact"),
        repoPath,
        context: assessCtx,
        schema: ImpactResult,
      }),
    ),
    pool(() =>
      runAgent({
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

  return {};
}
