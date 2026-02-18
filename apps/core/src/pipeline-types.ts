/**
 * Declarative pipeline configuration types.
 * Defines the shape of `swarm.config.yaml` — the single file that controls
 * which agents exist, how they connect, and in what order phases execute.
 */

/** Source for agent instructions: "builtin:<name>" or a file path. */
export type AgentSource = string;

/** A single review step within a phase. */
export interface ReviewStepConfig {
  readonly agent: string;
  readonly maxIterations: number;
  readonly approvalKeyword: string;
  readonly clarificationKeyword?: string;
  readonly clarificationAgent?: string;
}

/** QA step within an implement phase. */
export interface QaStepConfig {
  readonly agent: string;
  readonly maxIterations: number;
  readonly approvalKeyword: string;
}

/** Phase: specification drafting with reviews. */
export interface SpecPhaseConfig {
  readonly phase: "spec";
  readonly condition?: string;
  readonly agent: string;
  readonly reviews: readonly ReviewStepConfig[];
}

/** Phase: task decomposition. */
export interface DecomposePhaseConfig {
  readonly phase: "decompose";
  readonly agent: string;
  readonly frontendMarker: string;
}

/** Phase: design (conditional on frontend tasks). */
export interface DesignPhaseConfig {
  readonly phase: "design";
  readonly condition?: string;
  readonly agent: string;
  readonly clarificationAgent?: string;
  readonly reviews: readonly ReviewStepConfig[];
}

/** Phase: implementation per task. */
export interface ImplementPhaseConfig {
  readonly phase: "implement";
  readonly parallel: boolean;
  readonly agent: string;
  readonly clarificationAgent?: string;
  readonly clarificationKeyword?: string;
  readonly reviews: readonly ReviewStepConfig[];
  readonly qa?: QaStepConfig;
}

/** Phase: cross-model review. */
export interface CrossModelReviewPhaseConfig {
  readonly phase: "cross-model-review";
  readonly condition?: string;
  readonly agent: string;
  readonly fixAgent: string;
  readonly maxIterations: number;
  readonly approvalKeyword: string;
}

/** Verification commands to run after implementation. */
export interface VerifyConfig {
  readonly build?: string;
  readonly test?: string;
  readonly lint?: string;
}

/** Phase: verification — runs shell commands and loops until they pass. */
export interface VerifyPhaseConfig {
  readonly phase: "verify";
  readonly fixAgent: string;
  readonly maxIterations: number;
}

export type PhaseConfig =
  | SpecPhaseConfig
  | DecomposePhaseConfig
  | DesignPhaseConfig
  | ImplementPhaseConfig
  | CrossModelReviewPhaseConfig
  | VerifyPhaseConfig;

/** Root configuration loaded from `swarm.config.yaml`. */
export interface PipelineConfig {
  readonly primaryModel: string;
  readonly reviewModel: string;
  readonly agents: Readonly<Record<string, AgentSource>>;
  readonly pipeline: readonly PhaseConfig[];
  /** Optional verification commands — CLI flags override these. */
  readonly verify?: VerifyConfig;
}
