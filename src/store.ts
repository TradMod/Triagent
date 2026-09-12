import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import type { z } from "zod";
import type { Usage } from "@openai/codex-sdk";
import type { AgentResult, AgentStatus } from "./codex.ts";

// One line in logs/events.jsonl. This log doubles as the run manifest: every
// stage (including FAILED/TIMED_OUT ones that write no result file) lands here,
// so an interrupted run is fully inspectable without rerunning anything.
export interface RunEvent {
  ts: string;
  stage: string;
  status: AgentStatus | "INPUT" | "INFO";
  threadId?: string | null;
  usage?: Usage | null;
  error?: string;
  note?: string;
}

// Disk-backed run state under runs/<run-id>/{input,results,logs}.
// The filesystem is the state — there is no parallel in-memory TriageState.
export class RunStore {
  readonly runId: string;
  readonly dir: string;

  private constructor(runId: string, dir: string) {
    this.runId = runId;
    this.dir = dir;
  }

  static create(baseDir = resolve("runs")): RunStore {
    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const dir = resolve(baseDir, runId);
    for (const sub of ["input", "results", "logs"]) mkdirSync(join(dir, sub), { recursive: true });
    const store = new RunStore(runId, dir);
    store.logEvent({ stage: "run", status: "INFO", note: "created" });
    return store;
  }

  // Reopen a finished/interrupted run for inspection.
  static open(dir: string): RunStore {
    const abs = resolve(dir);
    if (!existsSync(abs)) throw new Error(`run dir not found: ${abs}`);
    return new RunStore(basename(abs), abs);
  }

  saveInput(name: string, content: string): void {
    writeFileSync(join(this.dir, "input", name), content);
    this.logEvent({ stage: name, status: "INPUT" });
  }

  // Record a stage: always logs an event; writes the validated output file only
  // when the agent produced output (i.e. COMPLETED).
  saveResult<T>(name: string, result: AgentResult<T>): void {
    this.logEvent({
      stage: name,
      status: result.status,
      threadId: result.threadId,
      usage: result.usage,
      error: result.error,
    });
    if (result.output !== undefined) {
      writeFileSync(this.resultPath(name), JSON.stringify(result.output, null, 2));
    }
  }

  loadResult<T>(name: string, schema: z.ZodType<T>): T {
    return schema.parse(JSON.parse(readFileSync(this.resultPath(name), "utf8")));
  }

  // Write an already-assembled/validated object (e.g. final.json) that is not an AgentResult.
  saveJson(name: string, data: unknown): void {
    writeFileSync(this.resultPath(name), JSON.stringify(data, null, 2));
  }

  has(name: string): boolean {
    return existsSync(this.resultPath(name));
  }

  logEvent(event: Omit<RunEvent, "ts">): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    appendFileSync(join(this.dir, "logs", "events.jsonl"), line + "\n");
  }

  resultPath(name: string): string {
    return join(this.dir, "results", name.endsWith(".json") ? name : `${name}.json`);
  }
}
