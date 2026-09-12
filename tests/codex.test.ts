// Offline self-check for the runAgent money path (retry, timeout, status) and
// the concurrency limiter. No live Codex calls — a fake client drives outcomes.
// Run: node tests/codex.test.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { runAgent, limit, type ClientLike } from "../src/codex.ts";

const Schema = z.object({ ok: z.boolean() });

// Fake client whose run() replays a queue of finalResponse strings.
function fakeClient(responses: string[]) {
  let runCount = 0;
  const client: ClientLike = {
    startThread() {
      return {
        id: "fake-thread",
        async run() {
          const text = responses[Math.min(runCount, responses.length - 1)]!;
          runCount++;
          return { items: [], finalResponse: text, usage: null };
        },
      };
    },
  };
  return { client, runs: () => runCount };
}

async function main() {
  // 1. invalid-then-valid -> COMPLETED, retried once.
  {
    const f = fakeClient(["not json", '{"ok":true}']);
    const r = await runAgent({ role: "t", prompt: "p", repoPath: ".", schema: Schema, codex: f.client });
    assert.equal(r.status, "COMPLETED");
    assert.deepEqual(r.output, { ok: true });
    assert.equal(f.runs(), 2);
  }

  // 2. always invalid -> FAILED after maxRetries+1 attempts.
  {
    const f = fakeClient(["nope"]);
    const r = await runAgent({ role: "t", prompt: "p", repoPath: ".", schema: Schema, codex: f.client, maxRetries: 1 });
    assert.equal(r.status, "FAILED");
    assert.equal(f.runs(), 2);
    assert.match(r.error!, /invalid output/);
  }

  // 3. slow run + short timeout -> TIMED_OUT via AbortSignal.
  // The fake uses a ref'd timer (like a real network call) so the loop stays
  // alive until the unref'd AbortSignal.timeout fires and aborts it.
  {
    const client: ClientLike = {
      startThread() {
        return {
          id: "fake",
          run: (_i, opts) =>
            new Promise((res, rej) => {
              const t = setTimeout(() => res({ items: [], finalResponse: '{"ok":true}', usage: null }), 1000);
              opts?.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(t);
                  rej(new Error("aborted"));
                },
                { once: true },
              );
            }),
        };
      },
    };
    const r = await runAgent({ role: "t", prompt: "p", repoPath: ".", schema: Schema, codex: client, timeoutMs: 20 });
    assert.equal(r.status, "TIMED_OUT");
  }

  // 4. limiter never exceeds the cap and runs everything.
  {
    const run = limit(2);
    let active = 0;
    let peak = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          done++;
        }),
      ),
    );
    assert.ok(peak <= 2, `peak concurrency ${peak} > 2`);
    assert.equal(done, 6);
  }

  console.log("codex.test.ts: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
