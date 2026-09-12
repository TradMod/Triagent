// Offline self-check for RunStore persistence. No live Codex calls.
// Run: node tests/store.test.ts
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { RunStore } from "../src/store.ts";
import type { AgentResult } from "../src/codex.ts";

const Schema = z.object({ verdict: z.string(), confidence: z.number() });
type T = z.infer<typeof Schema>;

function main() {
  const base = mkdtempSync(join(tmpdir(), "triagent-store-"));
  try {
    const store = RunStore.create(base);
    store.saveInput("report.md", "# hello");

    // COMPLETED -> result file written and reloads validated.
    const ok: AgentResult<T> = {
      status: "COMPLETED",
      role: "root_cause",
      threadId: "th-1",
      output: { verdict: "VALID", confidence: 80 },
      usage: null,
    };
    store.saveResult("root_cause", ok);
    assert.ok(store.has("root_cause"));
    assert.deepEqual(store.loadResult("root_cause", Schema), ok.output);

    // FAILED -> no result file, but the event is logged (inspectable).
    const bad: AgentResult<T> = { status: "FAILED", role: "spam", threadId: "th-2", error: "boom" };
    store.saveResult("spam", bad);
    assert.equal(store.has("spam"), false);

    // Bad data on disk fails validation on load.
    store.saveResult("junk", { status: "COMPLETED", role: "j", threadId: null, output: { verdict: 1 } as unknown as T });
    assert.throws(() => store.loadResult("junk", Schema));

    // Reopen the run independently and read it back.
    const reopened = RunStore.open(store.dir);
    assert.deepEqual(reopened.loadResult("root_cause", Schema), ok.output);

    // Event log captured every stage, including the FAILED one.
    const events = readFileSync(join(store.dir, "logs", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const spamEvent = events.find((e) => e.stage === "spam");
    assert.equal(spamEvent.status, "FAILED");
    assert.equal(spamEvent.error, "boom");
    assert.ok(events.some((e) => e.stage === "report.md" && e.status === "INPUT"));

    console.log("store.test.ts: all checks passed");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main();
