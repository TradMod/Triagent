# Triagent - Security Report Triage System

## 1. Purpose

Triagent is an agentic security triage system that takes:

1. a vulnerability report, and
2. the target codebase

and produces an evidence-backed triage decision.

The system must determine:

- whether the reported vulnerability is valid;
- whether the claimed root cause exists;
- whether the attack path is reachable;
- whether required assumptions and preconditions are satisfiable;
- whether the PoC is realistic and production-equivalent;
- the real impact and production exposure;
- exploit likelihood / feasibility;
- appropriate severity;
- confidence in the decision;
- review priority;
- mitigation guidance for valid findings.

Triagent must minimize report-induced bias and avoid wasting expensive analysis on obviously invalid submissions.

---

## 2. Core Principles

### 2.1 Evidence over claims

No agent should treat the report's claims as ground truth.

Important conclusions must be backed by evidence from one or more of:

- source code;
- tests;
- runtime / configuration;
- protocol documentation;
- specifications;
- deployment state;
- execution results;
- git history where relevant.

### 2.2 Preserve technical detail, remove persuasive bias

The normalized report must preserve all technical claims, attack steps, prerequisites, evidence, code references, and PoC details.

It should remove or isolate persuasive framing such as:

- claimed severity;
- exaggerated impact language;
- confidence statements;
- urgency language.

Downstream agents should not see the reporter's claimed severity unless explicitly required.

### 2.3 Gated execution

Triagent must not run every agent blindly.

Use sequential gates when downstream analysis depends on upstream validity.

Examples:

- If the submission is obvious spam, stop.
- If the root cause is conclusively invalid, deep impact analysis is unnecessary.
- If the attack path cannot reach the vulnerable state, production impact analysis may be skipped.

### 2.4 Parallelize independent investigation

Run agents in parallel when they investigate independent questions.

Example:

- implementation/root-cause validation;
- intended-behavior analysis.

### 2.5 Separate validity, impact, likelihood, severity, confidence, and priority

These are distinct concepts and must not be conflated.

Example:

- Severity: Critical
- Confidence: 90%
- Priority: 5/5

A potentially catastrophic finding with incomplete evidence should still receive urgent human review.

---

# 3. High-Level Architecture

```text
                         MAIN ORCHESTRATOR
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
     Protocol Context                       Report Normalizer
             |                                     |
             +------------------+------------------+
                                |
                                v
                           SPAM CHECK
                                |
                    obvious invalid?
                         /           \
                       YES            NO
                        |              |
                      REJECT           v
                              ROOT CAUSE STAGE
                               /             \
                              v               v
                    Root Cause         Intended Behavior
                     Validator              Agent
                              \               /
                               +------+------+
                                      |
                                      v
                              Root Cause Judge
                                      |
                              root cause valid?
                               /            \
                             NO              YES/UNCERTAIN
                              |                  |
                            REJECT               v
                         DEEP TRIAGE STAGE
                         /        |        \
                        v         v         v
                 Attack Path  Assumptions  PoC/Repro
                        \         |         /
                         +--------+--------+
                                  |
                                  v
                        Exploitability Judge
                                  |
                           exploitable?
                           /         \
                         NO           YES
                          |             |
                    REJECT/DOWNGRADE    v
                                +-------+-------+
                                |               |
                                v               v
                             Impact         Likelihood
                                |               |
                                +-------+-------+
                                        |
                                        v
                              Contradiction Review
                                        |
                              unresolved conflict?
                                /             \
                              YES              NO
                               |                |
                       Targeted sub-agent       |
                               +--------+-------+
                                        |
                                        v
                                  Evidence Audit
                                        |
                                        v
                                Validity Decision
                                        |
                               valid?
                              /      \
                            NO        YES
                             |          |
                           REJECT       v
                                  Mitigation Agent
                                        |
                                        v
                                   MAIN TRIAGER
                                        |
                          +-------------+-------------+
                          |             |             |
                          v             v             v
                       Severity     Confidence      Priority
                                        |
                                        v
                                  FINAL RESULT
```

---

# 4. Agent Responsibilities

## 4.1 Main Orchestrator and Main Triager

Two distinct roles, deliberately separated:

**Main Orchestrator — deterministic application code (not an agent).**

Responsibilities:

- spawn specialist agents;
- control DAG flow and enforce gating;
- run independent agents in parallel;
- provide agents only the context they need;
- handle retries and follow-up execution;
- spawn targeted sub-agents when uncertainty or contradiction remains;
- own shared state and persistence.

The orchestrator performs no security reasoning.

**Main Triager — final-decision Codex agent only.**

Responsibilities:

- receive completed specialist outputs;
- synthesize final validity;
- assign severity;
- assign confidence;
- assign priority;
- produce the final reasoning and triage result.

The Main Triager should not blindly redo all specialist analysis, and it does
not control execution or gating — that is the orchestrator's job.

---

## 4.2 Protocol Context Agent

Goal: build report-relevant protocol context.

The agent should identify only context relevant to the submitted finding.

Output:

- relevant components;
- relevant actors;
- trust boundaries;
- relevant permissions;
- relevant state;
- key invariants;
- relevant configuration;
- relevant execution flows;
- relevant external dependencies.

Avoid producing a generic full-protocol summary.

---

## 4.3 Report Normalizer

Goal: convert the original report into a neutral technical representation.

The normalized report must preserve:

- claimed root cause;
- affected components/functions;
- attack sequence;
- attacker capabilities;
- victim conditions;
- explicit prerequisites;
- technical assumptions;
- claimed impact;
- code references;
- PoC details;
- supporting evidence.

The following should be isolated from downstream reasoning:

- reporter severity;
- persuasive wording;
- unsupported certainty;
- exaggerated impact framing.

Suggested output:

```json
{
  "technical_claim": "",
  "claimed_root_cause": "",
  "claimed_attack_path": [],
  "claimed_preconditions": [],
  "claimed_impact": "",
  "claimed_severity": "",
  "code_references": [],
  "evidence_provided": [],
  "poc_provided": false,
  "unknowns": []
}
```

---

## 4.4 Spam Checker

Goal: cheaply reject submissions that clearly do not justify full triage.

The Spam Checker is a high-recall filter, not a final security judge.

Possible verdicts:

- `PASS`
- `FAIL`
- `UNCERTAIN`

`UNCERTAIN` must continue to full triage.

Examples of valid `FAIL` cases:

- no meaningful security claim;
- target code/component does not exist;
- entirely unrelated to target/scope;
- pure feature request;
- nonsensical or impossible attack model;
- report contains no causal path from behavior to impact;
- obvious spam/template garbage.

It should avoid rejecting technically plausible reports merely because they are poorly written.

---

# 5. Root Cause Stage

## 5.1 Root Cause Validator

Goal: independently verify whether the claimed faulty behavior exists in the implementation.

Investigate:

- relevant reads;
- relevant writes;
- state transitions;
- access restrictions;
- guards;
- call graph;
- arithmetic/accounting behavior;
- configuration constraints;
- related code paths.

The agent must actively try to falsify the claimed root cause.

Output:

- verdict: `VALID | INVALID | UNCERTAIN`;
- exact affected code;
- technical reasoning;
- contradicting protections if any;
- evidence;
- confidence.

---

## 5.2 Intended Behavior Agent

Goal: independently determine what the system is intended to do.

Evidence sources may include:

- protocol documentation;
- specifications;
- comments;
- interfaces;
- tests;
- invariants;
- surrounding implementation;
- git history when useful.

The Intended Behavior Agent must not assume the report's interpretation is correct.

Output:

- intended behavior;
- supporting evidence;
- whether observed implementation deviates from intent;
- confidence.

---

## 5.3 Root Cause Judge

Inputs:

- Root Cause Validator result;
- Intended Behavior result.

Goal: determine whether a genuine security-relevant root cause exists.

Possible verdicts:

- `VALID`
- `INVALID`
- `UNCERTAIN`

If conclusively `INVALID`, stop deep triage.

If `UNCERTAIN`, continue only when further analysis may resolve the issue.

---

# 6. Deep Triage Stage

## 6.1 Attack Path Agent

Goal: construct the full attacker-controlled execution path.

The agent should map:

```text
Attacker capability
    ->
Entry point
    ->
Authorization / dispatch
    ->
Required state
    ->
Vulnerable operation
    ->
Intermediate state
    ->
Impact-producing action
    ->
Attacker benefit / victim loss
```

It must identify:

- exact attacker capabilities;
- every required step;
- blockers or guards;
- unreachable transitions;
- weakest step in the attack;
- alternate paths when the report's exact path fails.

Output:

- `REACHABLE | UNREACHABLE | PARTIAL | UNCERTAIN`;
- full execution path;
- blockers;
- alternate exploit paths;
- evidence.

---

## 6.2 Assumptions and Preconditions Agent

Goal: identify and independently verify every condition required for exploitation.

Classify:

- explicit report assumptions;
- implicit assumptions;
- attacker prerequisites;
- victim prerequisites;
- protocol-state prerequisites;
- configuration prerequisites;
- environmental prerequisites;
- external-system prerequisites.

Each condition should be marked:

- `SATISFIED`
- `UNSATISFIED`
- `CONDITIONAL`
- `UNKNOWN`

Example:

```text
Attacker controls normal account          SATISFIED
Victim previously delegated proxy         CONDITIONAL
Affected feature enabled in production    SATISFIED
Oracle can remain stale indefinitely      UNSATISFIED
Admin cooperation required                NO
```

Any blocking precondition must be highlighted.

Search for more pre-conditions that the reports missed and analyze them.

---

## 6.3 PoC / Reproduction Agent

Goal:

1. analyze the supplied PoC;
2. map each PoC step to real production behavior;

The agent must distinguish:

- a production-realistic exploit.

Check for:

- artificial storage/state manipulation;
- unrealistic impersonation;
- impossible initialization;
- mocks;
- test-only interfaces;
- privileged setup;
- fork/testnet/mainnet differences;
- missing external conditions.

Output:

- PoC status;
- production equivalence;
- artificial assumptions;
- demonstrated impact;
- execution evidence.

A missing or broken PoC alone must not automatically invalidate an otherwise proven vulnerability.

---

# 7. Exploitability Judge

Inputs:

- Attack Path Agent;
- Assumptions/Preconditions Agent;
- PoC/Reproduction Agent.

Goal: determine whether the root cause can produce a security-relevant exploit.

Possible verdicts:

- `EXPLOITABLE`
- `NOT_EXPLOITABLE`
- `CONDITIONAL`
- `UNCERTAIN`

If not exploitable, the finding may be rejected or downgraded depending on the nature of the underlying defect.

---

# 8. Impact Analysis

Run only after exploitability is established or strongly supported.

The Impact Agent must distinguish three concepts:

### 8.1 Demonstrated Impact

What has been concretely proven.

### 8.2 Maximum Technical Impact

The maximum impact possible if all technically satisfiable conditions are met.

### 8.3 Current Production Exposure

What is currently exposed on the deployed system.

The Impact Agent should analyze:

- assets affected;
- direct loss;
- indirect loss;
- blast radius;
- affected users;
- affected contracts/modules;
- protocol solvency;
- governance impact;
- privilege escalation;
- permanent/temporary fund freezing;
- repeatability;
- production deployment status;
- affected version/commit;
- relevant runtime/configuration;
- current on-chain exposure where available.

Output must clearly separate theoretical maximum exposure from currently observable production exposure.

---

# 9. Likelihood / Feasibility Agent

Goal: evaluate how realistically the validated exploit can occur.

Do not determine impact.

Evaluate:

- attacker privilege;
- required capital;
- number of transactions;
- timing constraints;
- race conditions;
- victim interaction;
- market conditions;
- liquidity requirements;
- oracle conditions;
- external dependencies;
- key compromise requirements;
- repeatability;
- reliability;
- operational complexity.

Suggested output:

```json
{
  "attacker_access": "",
  "capital_requirement": "",
  "timing_requirement": "",
  "victim_interaction": "",
  "external_conditions": [],
  "repeatability": "",
  "reliability": "",
  "overall_likelihood": "LOW | MEDIUM | HIGH"
}
```

---

# 10. Contradiction Reviewer

Goal: identify disagreement between specialist agents.

Examples:

- Root Cause Agent says no privilege is required, while Attack Path Agent requires admin.
- Impact Agent claims protocol-wide loss, while blast-radius analysis shows one user only.
- PoC succeeds only under a state that Preconditions Agent marks impossible.

The reviewer must output:

- contradictions;
- unsupported conclusions;
- unresolved questions;
- recommended targeted re-investigation.

The Main Triager may spawn narrow sub-agents to resolve these issues.

---

# 11. Evidence Auditor

Goal: ensure material conclusions are evidence-backed.

For each important conclusion, check for:

- claim;
- supporting evidence;
- code location / execution evidence;
- reasoning;
- confidence.

The auditor should flag:

- unsupported assertions;
- hallucinated behavior;
- missing code references;
- weak inference;
- conclusions based only on report wording.

The Evidence Auditor does not determine severity.

---

# 12. Mitigation Agent

Run only for valid findings.

Responsibilities:

### Immediate Fix

Recommend the minimal safe change that addresses the root cause.

### Long-Term Prevention

Recommend measures such as:

- invariant tests;
- regression tests;
- fuzzing;
- permission-model improvements;
- safer accounting patterns;
- configuration guards;
- monitoring;
- architectural safeguards.

Mitigation must address the validated root cause, not just the submitted PoC.

---

# 13. Final Decision

The Main Triager receives all validated specialist outputs and produces the final result.

## 13.1 Validity

Allowed values:

- `VALID`
- `INVALID`
- `PARTIALLY_VALID`
- `NEEDS_MORE_INFO`

## 13.2 Severity

Severity must be assigned only after impact and likelihood are analyzed.

Recommended scale:

- `CRITICAL`
- `HIGH`
- `MEDIUM`
- `LOW`
- `INFORMATIONAL`

Severity should be derived from validated impact and validated likelihood, plus any configured bounty/program severity rules.

The report's submitted severity must not anchor the decision.

## 13.3 Confidence

A numeric confidence score:

```text
0-100
```

Confidence measures certainty in the triage conclusion, not vulnerability severity.

## 13.4 Priority

Priority is a human-review urgency signal:

```text
1-5
```

Suggested interpretation:

| Priority | Meaning |
|---|---|
| 5 | Immediate human review |
| 4 | High-priority review |
| 3 | Normal triage queue |
| 2 | Low urgency |
| 1 | Informational / low-value review |

Priority should consider:

- severity;
- confidence;
- production exposure;
- uncertainty;
- urgency.

High potential impact with incomplete evidence may still receive Priority 5.

---

# 14. Final Output Schema

Suggested final output:

```json
{
  "verdict": "VALID | INVALID | PARTIALLY_VALID | NEEDS_MORE_INFO",

  "severity": "CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL",
  "confidence": 0-100,
  "priority": 1-5,

  "summary": "",

  "root_cause": {
    "verdict": "",
    "description": "",
    "affected_code": [],
    "intended_behavior": "",
    "evidence": []
  },

  "attack_path": {
    "status": "",
    "steps": [],
    "blockers": [],
    "alternate_paths": []
  },

  "preconditions": {
    "required": [],
    "blocking": [],
    "missing_from_report": []
  },

  "poc": {
    "provided": false,
    "production_equivalent": false,
    "artificial_assumptions": [],
    "demonstrated_impact": ""
  },

  "impact": {
    "demonstrated": "",
    "maximum_technical": "",
    "production_exposure": "",
    "blast_radius": ""
  },

  "likelihood": {
    "rating": "LOW | MEDIUM | HIGH",
    "reasoning": ""
  },

  "production_status": {
    "affected": null,
    "version": "",
    "configuration": "",
    "evidence": []
  },

  "contradictions": [],

  "mitigation": {
    "immediate": "",
    "long_term": []
  },

  "open_questions": [],

  "evidence": []
}
```

---

# 15. Execution Rules

1. Protocol Context Agent and Report Normalizer may run in parallel.
2. Spam Check runs before expensive analysis.
3. Root Cause Stage must complete before deep triage.
4. Root Cause Validator and Intended Behavior Agent should run independently and in parallel.
5. Attack Path, Preconditions, and PoC analysis may run in parallel after root-cause validation.
6. Exploitability must be synthesized before expensive impact analysis.
7. Impact and Likelihood may run in parallel.
8. Contradiction Review runs after specialist analysis.
9. Targeted sub-agents may be spawned to resolve specific contradictions or unknowns.
10. Evidence Audit runs before final adjudication.
11. Mitigation runs only for valid findings.
12. Severity is assigned only by the final Main Triager after impact and likelihood are available.
13. Agents should terminate early when downstream work is no longer meaningful.
14. Agents should not infer facts solely from the vulnerability report when the codebase can verify them.
15. All high-impact conclusions should include traceable evidence.

---

# 16. Non-Goals for V1

V1 does not require:

- automatic bounty payout decisions;
- automatic communication with reporters;
- automatic remediation commits;
- fully autonomous production/on-chain data retrieval;
- reinforcement learning;
- vulnerability discovery unrelated to the submitted report;
- duplicate / known-issue detection;
- exhaustive analysis of the entire protocol.

The primary goal is accurate, efficient, evidence-backed triage of submitted security reports.

---

# 17. Success Criteria

Triagent is successful when it can consistently:

1. reject obvious spam cheaply;
2. validate or falsify the actual root cause;
3. distinguish intended behavior from implementation defects;
4. reconstruct realistic attack paths;
5. identify hidden assumptions and blockers;
6. distinguish test-only PoCs from production-feasible exploits;
7. determine real impact and production exposure;
8. evaluate exploit likelihood independently of impact;
9. avoid anchoring on reporter severity;
10. produce evidence-backed, reproducible triage decisions;
11. identify uncertainty rather than hallucinating certainty;
12. escalate high-risk or ambiguous findings for human review.
