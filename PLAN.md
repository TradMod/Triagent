# TriAgent — Phased Implementation Plan

## Goal

Build a working V1 of TriAgent that can take:

```text
vulnerability report + local codebase
```

and produce an evidence-backed triage result using Codex SDK / Codex harness agents.

Keep V1 simple. Do not add custom RAG, embeddings, databases, or RL until evaluations show they are needed.

---

# Phase 0 — Project Skeleton

## Build

Create the basic TypeScript project:

```text
src/
prompts/
runs/
tests/
SPEC.md
ARCHITECTURE.md
PLAN.md
```

Add:

- TypeScript
- Codex SDK integration
- Zod
- CLI entry point
- basic logging
- run ID generation

## Deliverable

A CLI command can start a triage run:

```bash
triagent triage --report ./report.md --repo ./target-repo
```

No real triage logic yet.

## Exit Criteria

- project builds;
- Codex SDK can start a thread;
- agent can read the target repository;
- structured agent output can be returned and validated.

---

# Phase 1 — Codex Agent Runtime

## Build

Create the reusable Codex adapter:

```text
startAgent()
runAgent()
resumeAgent()
collectResult()
```

Add:

- working-directory configuration;
- thread ID tracking;
- sandbox configuration;
- structured output validation;
- retries for malformed output;
- basic execution status handling;
- per-agent timeout (abort the turn via `TurnOptions.signal`);
- bounded concurrency cap on parallel agents.

The timeout and concurrency cap are dev-cost guardrails, not hardening: with
~17 agents per run, a hung agent burns money. The SDK's `AbortSignal` gives a
real stop button — wire the timeout to it. Land both before running the
pipeline repeatedly.

Statuses:

```text
COMPLETED
FAILED
TIMED_OUT
BLOCKED
NEEDS_FOLLOWUP
```

## Deliverable

A generic function can spawn any specialist agent from:

```text
prompt
+
repo
+
context
+
output schema
```

## Exit Criteria

A test agent can:

1. inspect the repo;
2. run safe commands;
3. return schema-valid JSON;
4. persist its result.

---

# Phase 2 — Shared State and Persistence

## Build

Implement:

```text
TriageState
Evidence
AgentResult
FinalTriageResult
```

Persist each run under:

```text
runs/<run-id>/
```

Save:

- inputs;
- agent outputs;
- thread IDs;
- final result;
- event log.

## Deliverable

A failed or interrupted triage run can be inspected without rerunning every stage.

## Exit Criteria

All agent outputs are validated and stored independently.

---

# Phase 3 — Intake Agents

Implement:

1. Protocol Context Agent
2. Report Normalizer
3. Spam Checker

Run:

```text
Protocol Context ─┐
                  ├─> Spam Gate
Report Normalizer ┘
```

Protocol Context and Report Normalizer run in parallel.

## Prompts

Create starter prompts:

```text
protocol_context.md
normalize_report.md
spam_checker.md
```

These are V1 prompts and will be manually refined later.

## Deliverable

Given a real report and repo, TriAgent produces:

```text
normalized_report.json
protocol_context.json
spam.json
```

## Exit Criteria

- normalization preserves all technical details;
- reporter severity is isolated;
- context is report-specific;
- spam filter uses `PASS | FAIL | UNCERTAIN`;
- `UNCERTAIN` continues.

---

# Phase 4 — Root Cause Stage

Implement:

1. Root Cause Validator
2. Intended Behavior Agent
3. Root Cause Judge

Run the first two in parallel:

```text
Root Cause Validator ─┐
                      ├─> Root Cause Judge
Intended Behavior ────┘
```

## Gate

```text
INVALID   -> stop / reject
VALID     -> continue
UNCERTAIN -> continue when deeper investigation may resolve it
```

## Deliverable

A root-cause verdict backed by code and intended-behavior evidence.

## Exit Criteria

TriAgent can correctly distinguish:

```text
real implementation defect
vs
intended behavior
vs
unsupported report claim
```

on a small curated test set.

---

# Phase 5 — Deep Triage Stage

Implement in parallel:

1. Attack Path Agent
2. Assumptions / Preconditions Agent
3. PoC / Reproduction Agent

Then implement:

4. Exploitability Judge

Flow:

```text
Attack Path ─────┐
Preconditions ───┼─> Exploitability Judge
PoC/Reproduction ┘
```

## Gate

```text
EXPLOITABLE
NOT_EXPLOITABLE
CONDITIONAL
UNCERTAIN
```

## Deliverable

TriAgent can determine whether a validated root cause can actually produce a security-relevant exploit.

## Exit Criteria

For test findings, the system can identify:

- unreachable paths;
- hidden blockers;
- unrealistic PoCs;
- missing preconditions;
- production-feasible paths.

---

# Phase 6 — Impact and Likelihood

Implement in parallel:

1. Impact Agent
2. Likelihood Agent

Impact must distinguish:

```text
Demonstrated Impact
Maximum Technical Impact
Current Production Exposure
```

Likelihood must independently assess:

```text
attacker access
capital
timing
victim interaction
external conditions
repeatability
reliability
```

## Deliverable

Structured impact and likelihood results without severity anchoring.

## Exit Criteria

Impact and likelihood remain independent and evidence-backed.

---

# Phase 7 — Contradiction and Evidence Review

Implement:

1. Contradiction Reviewer
2. Evidence Auditor
3. Targeted Investigator

Flow:

```text
specialist outputs
      |
      v
Contradiction Reviewer
      |
      +--> targeted investigation when needed
      |
      v
Evidence Auditor
```

Targeted investigators answer one narrow unresolved question.

## Deliverable

The pipeline can detect and resolve conflicting specialist conclusions.

## Exit Criteria

Unsupported or contradictory claims cannot silently reach the final verdict.

---

# Phase 8 — Final Triager

Implement the Main Triager.

Inputs:

- normalized report;
- protocol context;
- root cause;
- attack path;
- preconditions;
- PoC;
- exploitability;
- impact;
- likelihood;
- contradiction review;
- evidence audit.

The Main Triager decides:

```text
Validity
Severity
Confidence
Priority
```

Severity:

```text
CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL
```

Validity:

```text
VALID
INVALID
PARTIALLY_VALID
NEEDS_MORE_INFO
```

Priority:

```text
1-5
```

## Important

The reporter's claimed severity stays hidden until the system independently determines severity.

## Deliverable

`final.json`

## Exit Criteria

A complete report can run end-to-end through the gated pipeline and produce a defensible final decision.

---

# Phase 9 — Mitigation

Implement the Mitigation Agent.

Run only for valid findings.

Output:

```text
Immediate Fix
Long-Term Prevention
```

Mitigation must target the validated root cause rather than only the supplied PoC.

## Exit Criteria

Valid findings receive technically relevant remediation guidance without affecting validity or severity decisions.

---

# Phase 10 — Evaluation Harness

Before expanding features, build a real evaluation corpus.

Use previously triaged reports with known outcomes:

```text
VALID
INVALID
severity
known root cause
known blockers
duplicate/production context where available
```

Track at minimum:

```text
validity accuracy
false-negative rate
false-positive rate
severity accuracy
root-cause accuracy
attack-path accuracy
precondition accuracy
PoC assessment accuracy
cost
latency
agent failure rate
```

Prioritize false negatives heavily.

## Deliverable

Repeatable evaluation command:

```bash
triagent eval ./evals/corpus
```

## Exit Criteria

Changes to prompts or architecture can be measured against a stable baseline.

---

# Phase 11 — Prompt Refinement

Use evaluation failures to manually improve prompts.

Refine agents individually:

```text
normalize
spam
root cause
intended behavior
attack path
preconditions
PoC
impact
likelihood
judge
```

Do not change every prompt after every bad result.

Identify which stage failed and fix that stage.

## Deliverable

Version prompts:

```text
prompts/v1/
prompts/v2/
```

or maintain prompt-version metadata.

## Exit Criteria

Prompt changes show measurable improvement on the evaluation corpus.

---

# Phase 12 — V1 Hardening

Add only what evaluation shows is necessary.

Potential additions:

- retry policy;
- per-agent model configuration;
- token / cost tracking;
- caching;
- resume support;
- better logs;
- human-review escalation;
- deterministic evidence references.

## V1 Complete When

TriAgent can reliably:

1. ingest a report and repo;
2. reject obvious spam cheaply;
3. validate root cause;
4. reconstruct the attack path;
5. verify assumptions and preconditions;
6. assess PoC realism;
7. determine exploitability;
8. assess impact and likelihood;
9. detect contradictions;
10. produce an evidence-backed final verdict;
11. assign severity, confidence, and priority;
12. surface uncertainty instead of inventing certainty.

---

# Explicitly Defer Until After V1

Do not build these unless evaluations justify them:

```text
custom RAG
vector database
code embeddings
repository chunking
RL / fine-tuning
distributed workers
web UI
persistent database
automatic remediation commits
autonomous vulnerability discovery
duplicate / known-issue detection
```

---

# Recommended Build Order

```text
0. Project Skeleton
1. Codex Runtime
2. State + Persistence
3. Intake Agents
4. Root Cause Stage
5. Deep Triage
6. Impact + Likelihood
7. Contradiction + Evidence Review
8. Final Triager
9. Mitigation
10. Evaluation Harness
11. Prompt Refinement
12. V1 Hardening
```

Primary rule:

> Build the smallest complete triage loop first, then improve accuracy using evaluations rather than adding infrastructure speculatively.
