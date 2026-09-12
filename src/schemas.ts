import { z } from "zod";

// Shared building blocks reused by every specialist agent.
// Per-agent schemas extend BaseResult; the full final-triage and per-stage
// schemas arrive with their phases (3-9).

// ARCHITECTURE.md §15 — evidence is first-class data.
export const Evidence = z.object({
  type: z.enum(["code", "test", "documentation", "configuration", "execution", "deployment", "git"]),
  file: z.string().optional(),
  symbol: z.string().optional(),
  line: z.number().optional(),
  claim: z.string(),
  detail: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

// ARCHITECTURE.md §14 — minimum every agent result carries.
export const BaseResult = z.object({
  verdict: z.string(),
  summary: z.string(),
  evidence: z.array(Evidence),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type BaseResult = z.infer<typeof BaseResult>;
