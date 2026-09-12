import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, limit } from "./codex.ts";
import type { RunStore } from "./store.ts";
import { NormalizedReport, ProtocolContext, SpamResult, neutralReport } from "./schemas.ts";

const PROMPTS_DIR = join(import.meta.dirname, "..", "prompts");
const loadPrompt = (name: string) => readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");

// ponytail: fixed cap; expose per-run config when eval shows it matters.
const CONCURRENCY = 4;

export interface TriageOutcome {
  stopped?: "NORMALIZE_FAILED" | "SPAM";
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
  if (spam.status === "COMPLETED" && spam.output?.verdict === "FAIL") {
    store.logEvent({ stage: "gate:spam", status: "INFO", note: `rejected: ${spam.output.reasoning}` });
    return { stopped: "SPAM", reason: spam.output.reasoning };
  }

  store.logEvent({ stage: "gate:spam", status: "INFO", note: `passed (${spam.output?.verdict ?? spam.status})` });
  return {};
}
