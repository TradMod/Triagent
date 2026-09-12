import { Codex } from "@openai/codex-sdk";
import type { Input, SandboxMode, ThreadOptions, TurnOptions, RunResult as Turn, Usage } from "@openai/codex-sdk";
import type { z } from "zod";
import { z as zod } from "zod";

// Runtime execution status. COMPLETED/FAILED/TIMED_OUT are determined here;
// BLOCKED and NEEDS_FOLLOWUP are set by the orchestrator from an agent's own
// structured output (ARCHITECTURE.md §7, §19) — not by this runtime.
export type AgentStatus =
  | "COMPLETED"
  | "FAILED"
  | "TIMED_OUT"
  | "BLOCKED"
  | "NEEDS_FOLLOWUP";

export interface AgentResult<T> {
  status: AgentStatus;
  role: string;
  threadId: string | null;
  output?: T;
  error?: string;
  usage?: Usage | null;
}

export interface AgentRequest<T> {
  role: string;
  prompt: string;
  repoPath: string;
  context?: unknown;
  schema: z.ZodType<T>;
  model?: string;
  sandboxMode?: SandboxMode; // default: read-only
  timeoutMs?: number; // total budget across retries; default 5min
  maxRetries?: number; // malformed-output retries; default 2
  signal?: AbortSignal; // orchestrator cancel
  codex?: ClientLike; // injectable for tests
}

// Minimal structural view of the SDK surface runAgent uses; Codex satisfies it,
// and tests can supply a fake.
interface ThreadLike {
  readonly id: string | null;
  run(input: Input, opts?: TurnOptions): Promise<Turn>;
}
export interface ClientLike {
  startThread(options?: ThreadOptions): ThreadLike;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runAgent<T>(req: AgentRequest<T>): Promise<AgentResult<T>> {
  const {
    role,
    prompt,
    repoPath,
    context,
    schema,
    model,
    sandboxMode = "read-only",
    timeoutMs = 300_000,
    maxRetries = 2,
    signal,
    codex = new Codex(),
  } = req;

  const thread = codex.startThread({
    workingDirectory: repoPath,
    sandboxMode,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    ...(model ? { model } : {}),
  });

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const jsonSchema = zod.toJSONSchema(schema);

  let input: Input =
    context === undefined
      ? prompt
      : `${prompt}\n\n## Context (structured prior results)\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let turn: Turn;
    try {
      turn = await thread.run(input, { outputSchema: jsonSchema, signal: combined });
    } catch (err) {
      if (combined.aborted) {
        return { status: "TIMED_OUT", role, threadId: thread.id, error: `aborted after ${timeoutMs}ms` };
      }
      return { status: "FAILED", role, threadId: thread.id, error: msg(err) };
    }
    try {
      const output = schema.parse(JSON.parse(turn.finalResponse));
      return { status: "COMPLETED", role, threadId: thread.id, output, usage: turn.usage };
    } catch (err) {
      lastError = msg(err);
      input = `Your previous response was not valid JSON for the required schema (${lastError}). Return ONLY the JSON object — no prose, no code fences.`;
    }
  }
  return {
    status: "FAILED",
    role,
    threadId: thread.id,
    error: `invalid output after ${maxRetries + 1} attempts: ${lastError}`,
  };
}

// Tiny concurrency gate for parallel agent groups (Phase 3+).
// ponytail: FIFO in-process semaphore; swap for p-limit if fairness/perf ever matters.
export function limit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
