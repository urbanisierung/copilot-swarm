/**
 * Fleet configuration types.
 * Defines the shape of `fleet.config.yaml` — the file that specifies
 * which repositories participate in a cross-repo feature and how they relate.
 */

/** A single repository in the fleet. */
export interface FleetRepo {
  /** Absolute path to the repository root. */
  readonly path: string;
  /** Human-readable description of this repo's role in the feature. */
  readonly role: string;
}

/** Per-repo verify overrides in fleet config. */
export interface FleetRepoOverrides {
  readonly verifyBuild?: string;
  readonly verifyTest?: string;
  readonly verifyLint?: string;
}

/** Cross-repo dependency produced by the strategist agent. */
export interface FleetDependency {
  /** Repo path that must complete first. */
  readonly from: string;
  /** Repo path that depends on `from`. */
  readonly to: string;
  /** Description of the dependency (e.g., "API types must exist before frontend can consume them"). */
  readonly reason: string;
}

/** Per-repo task assignment from the strategist agent. */
export interface FleetRepoTasks {
  readonly repoPath: string;
  readonly tasks: string;
}

/** Strategy output from the strategist agent (parsed from markdown). */
export interface FleetStrategy {
  readonly sharedContracts: string;
  readonly repoTasks: readonly FleetRepoTasks[];
  readonly dependencies: readonly FleetDependency[];
  readonly waves: readonly string[][];
}

/** Fleet-level checkpoint state. */
export interface FleetCheckpoint {
  completedPhases: string[];
  analyses: Record<string, string>;
  strategy?: FleetStrategy;
  waveResults: Record<string, string>[];
  currentWave: number;
}

/** Root fleet configuration loaded from `fleet.config.yaml`. */
export interface FleetConfig {
  readonly repos: readonly FleetRepo[];
  readonly overrides?: Readonly<Record<string, FleetRepoOverrides>>;
  /** Optional integration test command to run after all repos complete. */
  readonly integrationTest?: string;
}
