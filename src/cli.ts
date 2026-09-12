#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";

// Phase 0 smoke schema: proves an agent can read the repo and return validated JSON.
// Real triage schemas arrive with the agents in later phases.
const SmokeSchema = z.object({
  summary: z.string(),
  primary_languages: z.array(z.string()),
});

function log(runId: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${runId}] ${msg}`);
}

async function triage(report: string, repo: string) {
  const reportPath = resolve(report);
  const repoPath = resolve(repo);
  const reportText = readFileSync(reportPath, "utf8"); // throws if missing

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = resolve("runs", runId);
  mkdirSync(resolve(runDir, "input"), { recursive: true });
  mkdirSync(resolve(runDir, "results"), { recursive: true });
  copyFileSync(reportPath, resolve(runDir, "input", "report.md"));

  log(runId, `report=${reportPath} repo=${repoPath}`);
  log(runId, "starting Codex smoke agent (read-only)...");

  const codex = new Codex(); // auth from ~/.codex/auth.json
  const thread = codex.startThread({
    workingDirectory: repoPath,
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
  });

  const turn = await thread.run(
    "Inspect this repository. Return a one-sentence summary of what it is and its primary programming languages.",
    { outputSchema: z.toJSONSchema(SmokeSchema) },
  );

  const result = SmokeSchema.parse(JSON.parse(turn.finalResponse));
  writeFileSync(resolve(runDir, "results", "smoke.json"), JSON.stringify(result, null, 2));

  log(runId, `thread=${thread.id} usage=${JSON.stringify(turn.usage)}`);
  log(runId, `result: ${JSON.stringify(result)}`);
  log(runId, `saved -> ${runDir}`);
  void reportText; // Phase 0: report is copied, not yet analyzed
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    report: { type: "string" },
    repo: { type: "string" },
  },
});

if (positionals[0] !== "triage" || !values.report || !values.repo) {
  console.error("usage: triagent triage --report <path> --repo <path>");
  process.exit(1);
}

triage(values.report, values.repo).catch((err) => {
  console.error("triage failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
