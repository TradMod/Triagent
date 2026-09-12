# Triagent — Architecture

## 1. Overview

Triagent is a local agentic security-report triage system built on top of the **Codex SDK / Codex harness**.

The application owns:

- workflow orchestration;
- agent spawning;
- dependency gates;
- parallel execution;
- structured result passing;
- retries / targeted re-investigation;
- final result persistence.

Codex owns the per-agent execution environment:

- agent loop;
- repository navigation;
- file reading;
- shell/tool execution;
- test execution;
- sandboxing;
- thread/session context;
- context management.

Each Triagent specialist is implemented as an **independent Codex thread/session**.

The Main Triager does not directly implement file-search, shell, or code-reading logic. It delegates investigation to Codex agents operating against the target repository.

---

# 2. Inputs

V1 accepts:

```text
report
repository_path
```

Optional:

```text
program_rules
severity_rules
deployment_context
additional_context
```

Duplicate / known-issue detection is out of scope for V1 (see §23).

Example:

```bash
Triagent triage \
  --report ./reports/report.md \
  --repo ./target-protocol
```

---

# 3. High-Level System

```text
                        CLI / API
                           |
                           v
                    Triage Runner
                           |
                           v
                +---------------------+
                |   Main Orchestrator |
                +----------+----------+
                           |
             +-------------+-------------+
             |                           |
             v                           v
      Protocol Context            Report Normalizer
         Codex Thread                Codex Thread
             |                           |
             +-------------+-------------+
                           |
                           v
                       Spam Gate
                           |
                    pass / stop
                           |
                           v
                  Root Cause Stage
                           |
                +----------+----------+
                |                     |
                v                     v
       Root Cause Validator    Intended Behavior
          Codex Thread           Codex Thread
                |                     |
                +----------+----------+
                           |
                           v
                   Root Cause Judge
                           |
                       pass / stop
                           |
                           v
                    Deep Triage
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
     Attack Path      Preconditions      PoC/Repro
     Codex Thread      Codex Thread      Codex Thread
          |                |                |
          +----------------+----------------+
                           |
                           v
                 Exploitability Judge
                           |
                       pass / stop
                           |
                           v
              +------------+------------+
              |                         |
              v                         v
        Impact Agent             Likelihood Agent
        Codex Thread              Codex Thread
              |                         |
              +------------+------------+
                           |
                           v
                Contradiction Review
                           |
                   conflict detected?
                      /          \
                    yes           no
                     |             |
                     v             |
             Targeted Codex       |
                Thread            |
                     +------+------+
                            |
                            v
                     Evidence Audit
                            |
                            v
                     Validity Decision
                            |
                       valid / reject
                            |
                         if valid
                            |
                            v
                    Mitigation Agent
                            |
                            v
                      Main Triager
                            |
               +------------+------------+
               |            |            |
               v            v            v
            Severity     Confidence    Priority
                            |
                            v
                      Final Result
```

---

# 4. Core Components

## 4.1 Triage Runner

Entry point for a triage run.

Responsibilities:

- validate inputs;
- create a unique run ID;
- initialize the Codex integration;
- provide the target repository as the working directory;
- start the Main Orchestrator;
- stream progress;
- persist final outputs.

The Triage Runner contains no security reasoning.

---

## 4.2 Main Orchestrator

The Main Orchestrator controls the triage DAG.

Responsibilities:

- spawn Codex agent threads;
- choose which agents run;
- run independent agents concurrently;
- enforce gates;
- pass structured outputs between stages;
- terminate unnecessary downstream work;
- spawn targeted investigators when needed;
- collect all final evidence;
- invoke the final Main Triager.

The orchestrator is deterministic application logic where possible.

Security reasoning should remain inside agents.

---

## 4.3 Codex Runtime Adapter

Thin wrapper around the Codex SDK (`@openai/codex-sdk`).

Maps to the real SDK surface:

```text
startAgent()    -> codex.startThread(ThreadOptions)
resumeAgent()   -> codex.resumeThread(threadId)   // sessions in ~/.codex (machine-local)
runAgent()      -> thread.run(input, TurnOptions) | thread.runStreamed(...)
collectResult() -> turn.finalResponse (+ turn.items)
```

Note: the SDK has **no cancel/abort for an in-flight `run()`** (openai/codex#5494).
A timeout is enforced app-side by abandoning the promise — the underlying agent
still runs to completion and bills. Gates therefore *avoid spawning* downstream
work; they cannot stop already-running parallel agents.

Conceptual interface:

```ts
interface AgentRequest {
  role: AgentRole;
  prompt: string;
  repoPath: string;              // -> ThreadOptions.workingDirectory
  context: unknown;
  outputSchema: JSONSchema;      // -> TurnOptions.outputSchema (native structured output)
  sandboxMode?: "read-only" | "workspace-write";  // read-only for analysis agents
  model?: string;               // per-agent model (e.g. cheap model for spam/intake)
}

interface AgentResult<T> {
  status: "completed" | "failed" | "timed_out";  // no native "needs_input"; use approvalPolicy
  output?: T;                   // absent on failure
  threadId: string;
}
```

Structured output is a first-class SDK feature (`TurnOptions.outputSchema`, returned
in `turn.finalResponse`); Zod validation is a backstop, not the primary mechanism.

The adapter hides Codex-specific implementation details from the triage workflow.

---

# 5. Agent Model

Every specialist agent has:

```text
Role Prompt
+
Task Context
+
Relevant Prior Results
+
Target Repository
+
Required Output Schema
```

Each agent gets its own Codex thread.

Agents should receive only the information required for their role.

Example:

```text
Root Cause Validator

receives:
- normalized technical report
- protocol context
- repository

does NOT need:
- reporter severity
- impact-agent conclusions
- mitigation suggestions
```

This reduces anchoring and cross-agent bias.

---

# 6. Agent Spawning

"Spawning an agent" means:

1. construct the role/task prompt;
2. create an independent Codex thread;
3. set the target repository as its working directory;
4. provide relevant structured context;
5. let the Codex harness investigate using repository and shell tools;
6. require structured output;
7. return the result to the orchestrator.

Conceptually:

```ts
const result = await spawnAgent({
  role: "root_cause_validator",
  prompt: prompts.rootCauseValidator,
  repoPath,
  context: {
    report: normalizedReport,
    protocol: protocolContext
  },
  outputSchema: RootCauseResultSchema
});
```

---

# 7. Parent / Sub-Agent Model

Triagent uses logical parent/child relationships.

Example:

```text
Root Cause Stage
      |
      +-- Root Cause Validator
      |
      +-- Intended Behavior Agent
      |
      +-- Root Cause Judge
```

The application orchestrator performs the actual thread creation.

Agents may request additional investigation through structured output:

```json
{
  "needs_followup": true,
  "followup": {
    "question": "Can validator eligibility persist after direct stake withdrawal?",
    "recommended_role": "targeted_investigator"
  }
}
```

The orchestrator can then spawn a new Codex thread for that exact question.

This supports sub-agents and sub-sub-agents without coupling the workflow to undocumented runtime behavior.

---

# 8. Context Flow

Do not share full agent histories across agents.

Pass **structured conclusions + evidence** instead.

Example:

```text
Root Cause Validator thread
         |
         v
RootCauseResult JSON
         |
         v
Root Cause Judge thread
```

Preferred result structure:

```json
{
  "verdict": "VALID",
  "summary": "...",
  "evidence": [
    {
      "file": "src/module.rs",
      "symbol": "function_name",
      "reason": "..."
    }
  ],
  "unknowns": [],
  "confidence": 94
}
```

This keeps context small and makes inter-agent reasoning inspectable.

---

# 9. Shared Context

A run maintains a shared state object.

Conceptually:

```ts
interface TriageState {
  runId: string;

  report: RawReport;
  normalizedReport?: NormalizedReport;
  protocolContext?: ProtocolContext;

  spam?: SpamResult;

  rootCauseValidation?: RootCauseResult;
  intendedBehavior?: IntendedBehaviorResult;
  rootCauseVerdict?: RootCauseVerdict;

  attackPath?: AttackPathResult;
  preconditions?: PreconditionsResult;
  poc?: PocResult;
  exploitability?: ExploitabilityResult;

  impact?: ImpactResult;
  likelihood?: LikelihoodResult;

  contradictions?: ContradictionResult;
  evidenceAudit?: EvidenceAuditResult;

  mitigation?: MitigationResult;

  final?: FinalTriageResult;
}
```

Agents do not mutate shared state directly.

The orchestrator validates their structured output and writes it into the run state.

---

# 10. Parallelism

Use parallel execution only for independent investigations.

## Parallel

```text
Protocol Context
Report Normalizer
```

```text
Root Cause Validator
Intended Behavior Agent
```

```text
Attack Path
Preconditions
PoC/Reproduction
```

```text
Impact
Likelihood
```

## Sequential / Gated

```text
Spam
  ->
Root Cause
  ->
Exploitability
  ->
Impact/Likelihood
  ->
Final Decision
```

Rule:

> Parallelize independent evidence gathering; serialize dependency.

---

# 11. Gates

## Gate 1 — Spam

```text
FAIL      -> terminate
PASS      -> continue
UNCERTAIN -> continue
```

---

## Gate 2 — Root Cause

```text
INVALID   -> terminate / reject
VALID     -> continue
UNCERTAIN -> continue when deeper investigation may resolve it
```

---

## Gate 3 — Exploitability

```text
EXPLOITABLE     -> impact + likelihood
CONDITIONAL     -> impact + likelihood with conditions
NOT_EXPLOITABLE -> reject / downgrade
UNCERTAIN       -> targeted investigation or human escalation
```

---

# 12. Dynamic Investigation

The workflow must support targeted follow-up agents.

Example:

```text
Attack Path Agent:
"validator eligibility is required but unverified"

Preconditions Agent:
"validator eligibility appears to persist"

Contradiction Reviewer:
"Evidence is insufficient."

        |
        v

Main Orchestrator spawns:

Targeted Investigator:
"Determine whether validator eligibility persists after X,
using code and tests only."
```

Targeted agents should answer one narrow question.

They should not re-triage the entire report.

---

# 13. Prompts

Prompts live outside application logic.

Recommended structure:

```text
prompts/
  main_triager.md
  protocol_context.md
  normalize_report.md
  spam_checker.md

  root_cause_validator.md
  intended_behavior.md
  root_cause_judge.md

  attack_path.md
  preconditions.md
  poc_reproduction.md
  exploitability_judge.md

  impact.md
  likelihood.md

  contradiction_reviewer.md
  evidence_auditor.md
  targeted_investigator.md

  mitigation.md
```

V1 may generate initial prompts automatically.

Prompts are expected to be manually refined over time.

No prompt text should be hardcoded deeply inside orchestration logic.

---

# 14. Structured Outputs

Every agent must return machine-parseable structured output.

Use schema validation.

Recommended:

```text
JSON Schema / Zod
```

Do not make downstream stages depend on parsing arbitrary prose.

Each result should contain at minimum:

```json
{
  "verdict": "",
  "summary": "",
  "evidence": [],
  "unknowns": [],
  "confidence": 0
}
```

Agent-specific schemas extend this base structure.

---

# 15. Evidence Model

Evidence should be first-class data.

Suggested representation:

```ts
interface Evidence {
  type:
    | "code"
    | "test"
    | "documentation"
    | "configuration"
    | "execution"
    | "deployment"
    | "git";

  file?: string;
  symbol?: string;
  line?: number;

  claim: string;
  detail: string;
}
```

Important conclusions should reference evidence IDs rather than rely only on prose.

---

# 16. Repository Access

All code-analysis agents operate against the same target repository.

The Codex harness handles:

- file discovery;
- file reading;
- grep/search;
- shell execution;
- test execution;
- code navigation.

Triagent should not initially build:

- code embeddings;
- vector search;
- custom RAG;
- repository chunking;
- manual context-window packing.

Add these only if evaluation shows the Codex harness alone is insufficient.

---

# 17. Sandbox Policy

Default posture:

```text
read repository
run safe local commands
run tests
write only to an isolated temporary workspace when needed
```

Agents should not:

- modify the source repository permanently;
- commit changes;
- push code;
- access unrelated user files;
- execute destructive commands.

PoC agents may create temporary test artifacts inside an isolated working area when required.

---

# 18. Run Storage

Recommended V1 layout:

```text
runs/
  <run-id>/
    input/
      report.md

    results/
      normalized_report.json
      protocol_context.json
      spam.json
      root_cause_validator.json
      intended_behavior.json
      root_cause.json
      attack_path.json
      preconditions.json
      poc.json
      exploitability.json
      impact.json
      likelihood.json
      contradictions.json
      evidence_audit.json
      mitigation.json
      final.json

    logs/
      events.jsonl
```

Agent thread IDs should also be persisted so investigations can be resumed or inspected.

---

# 19. Failure Handling

Agent failure must not automatically invalidate a report.

Examples:

```text
PoC agent fails to compile environment
!=
report is invalid
```

The orchestrator should distinguish:

```text
security verdict
agent/tool failure
missing evidence
environment failure
```

Suggested agent execution status:

```text
COMPLETED
FAILED
TIMED_OUT
BLOCKED
NEEDS_FOLLOWUP
```

Critical unresolved stages should produce:

```text
NEEDS_MORE_INFO
```

rather than fabricated certainty.

---

# 20. Main Triager

The final Main Triager receives:

- normalized report;
- protocol context;
- root-cause verdict;
- attack path;
- preconditions;
- PoC/reproduction result;
- exploitability verdict;
- impact;
- likelihood;
- contradictions;
- evidence audit;
- mitigation if valid.

It determines:

```text
Validity
Severity
Confidence
Priority
```

The submitted severity should remain hidden until after the Main Triager independently determines severity.

---

# 21. V1 Technology

Recommended:

```text
Runtime:        Node.js / TypeScript
Agent runtime:  Codex SDK / Codex harness
Validation:     Zod
CLI:            lightweight TypeScript CLI
Storage:        filesystem JSON / JSONL
Concurrency:    Promise-based worker pool
```

Avoid unnecessary infrastructure in V1.

No database is required initially.

---

# 22. Suggested Project Structure

```text
Triagent/
│
├── src/
│   ├── cli.ts
│   ├── triage.ts
│   │
│   ├── codex/
│   │   ├── client.ts
│   │   ├── spawn-agent.ts
│   │   └── types.ts
│   │
│   ├── orchestration/
│   │   ├── orchestrator.ts
│   │   ├── gates.ts
│   │   ├── parallel.ts
│   │   └── followups.ts
│   │
│   ├── agents/
│   │   ├── registry.ts
│   │   └── schemas/
│   │
│   ├── state/
│   │   ├── triage-state.ts
│   │   └── persistence.ts
│   │
│   └── output/
│       └── final-result.ts
│
├── prompts/
│   ├── main_triager.md
│   ├── protocol_context.md
│   ├── normalize_report.md
│   ├── spam_checker.md
│   ├── root_cause_validator.md
│   ├── intended_behavior.md
│   ├── root_cause_judge.md
│   ├── attack_path.md
│   ├── preconditions.md
│   ├── poc_reproduction.md
│   ├── exploitability_judge.md
│   ├── impact.md
│   ├── likelihood.md
│   ├── contradiction_reviewer.md
│   ├── evidence_auditor.md
│   ├── targeted_investigator.md
│   └── mitigation.md
│
├── runs/
├── tests/
│
├── SPEC.md
├── ARCHITECTURE.md
├── package.json
└── tsconfig.json
```

---

# 23. V1 Non-Goals

Do not initially build:

- custom vector database;
- code embeddings;
- custom code RAG;
- distributed worker infrastructure;
- web UI;
- permanent database;
- RL / fine-tuning;
- autonomous remediation;
- vulnerability discovery outside the submitted report;
- duplicate / known-issue detection;
- automatic payout decisions.

Focus V1 on proving that Codex-driven specialist agents can triage reports accurately.

---

# 24. Primary Design Rule

```text
Codex handles agent execution.
Triagent handles security workflow.
```

The harness should solve repository interaction and per-agent execution.

The Triagent codebase should remain focused on:

```text
who investigates
what they investigate
when they investigate
what evidence they return
when execution stops
how conclusions are reconciled
```

That separation should remain intact as the system evolves.
