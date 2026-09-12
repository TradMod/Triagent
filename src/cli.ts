#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { runAgent } from "./codex.ts";
import { RunStore } from "./store.ts";

// Smoke schema: proves an agent can read the repo, run a command, and return
// validated JSON. Real triage schemas arrive with the agents in later phases.
const SmokeSchema = z.object({
  summary: z.string(),
  primary_languages: z.array(z.string()),
  command_run: z.string(),
  file_count: z.number(),
});

function log(runId: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${runId}] ${msg}`);
}

async function triage(report: string, repo: string) {
  const reportPath = resolve(report);
  const repoPath = resolve(repo);
  const reportText = readFileSync(reportPath, "utf8"); // throws if missing

  const store = RunStore.create();
  store.saveInput("report.md", reportText);

  log(store.runId, `report=${reportPath} repo=${repoPath}`);
  log(store.runId, "starting Codex smoke agent (read-only)...");

  const res = await runAgent({
    role: "smoke",
    prompt:
      "Inspect this repository. Run a shell command to count its source files, " +
      "then return: a one-sentence summary, the primary programming languages, " +
      "the exact command you ran, and the resulting file count.",
    repoPath,
    schema: SmokeSchema,
  });
  store.saveResult("smoke", res);

  if (res.status !== "COMPLETED") {
    throw new Error(`smoke agent ${res.status}: ${res.error}`);
  }

  // Inspection: reload the persisted result independently of the run.
  const loaded = store.loadResult("smoke", SmokeSchema);
  log(store.runId, `thread=${res.threadId} status=${res.status} usage=${JSON.stringify(res.usage)}`);
  log(store.runId, `reloaded: ${JSON.stringify(loaded)}`);
  log(store.runId, `saved -> ${store.dir}`);
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
