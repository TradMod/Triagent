#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { triage } from "./orchestrator.ts";
import { RunStore } from "./store.ts";
import { FinalTriageResult } from "./schemas.ts";

function log(runId: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${runId}] ${msg}`);
}

async function main(report: string, repo: string) {
  const repoPath = resolve(repo);
  const reportText = readFileSync(resolve(report), "utf8"); // throws if missing

  const store = RunStore.create();
  store.saveInput("report.md", reportText);
  log(store.runId, `repo=${repoPath}`);
  log(store.runId, "running gated pipeline → final triage...");

  const outcome = await triage(store, reportText, repoPath);

  if (outcome.stopped) {
    log(store.runId, `stopped early at gate: ${outcome.stopped}`);
  }

  // final.json is written on every path (including early stops).
  const final = store.loadResult("final", FinalTriageResult);
  log(store.runId, `VERDICT: ${final.verdict} | severity ${final.severity} | confidence ${final.confidence} | priority ${final.priority}`);
  log(store.runId, `summary: ${final.summary}`);
  log(store.runId, `run -> ${store.dir}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { report: { type: "string" }, repo: { type: "string" } },
});

if (positionals[0] !== "triage" || !values.report || !values.repo) {
  console.error("usage: triagent triage --report <path> --repo <path>");
  process.exit(1);
}

main(values.report, values.repo).catch((err) => {
  console.error("triage failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
