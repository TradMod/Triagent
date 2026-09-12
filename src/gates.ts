import type { SpamResult, RootCauseVerdict, ExploitabilityResult, FinalTriageResult } from "./schemas.ts";

// Gate predicates: true == stop the pipeline. Pure functions so routing can be
// tested without spawning real Codex agents. Only a confident negative verdict
// stops; UNCERTAIN always continues (deeper stages may resolve it).

// Gate 1 (SPEC §4.4): FAIL stops; PASS/UNCERTAIN continue.
export const spamStops = (v: SpamResult["verdict"]): boolean => v === "FAIL";

// Gate 2 (SPEC §5.3): INVALID stops; VALID/UNCERTAIN continue.
export const rootCauseStops = (v: RootCauseVerdict["verdict"]): boolean => v === "INVALID";

// Gate 3 (SPEC §7): NOT_EXPLOITABLE stops (reject/downgrade);
// EXPLOITABLE/CONDITIONAL/UNCERTAIN continue.
export const exploitabilityStops = (v: ExploitabilityResult["verdict"]): boolean => v === "NOT_EXPLOITABLE";

// Mitigation (SPEC §12) runs only for valid findings.
export const isValidFinding = (v: FinalTriageResult["verdict"]): boolean =>
  v === "VALID" || v === "PARTIALLY_VALID";
