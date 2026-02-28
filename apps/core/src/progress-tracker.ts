export type PhaseStatus = "pending" | "active" | "done" | "skipped";
export type StreamStatus = "queued" | "engineering" | "reviewing" | "testing" | "done" | "failed" | "skipped";

export interface PhaseInfo {
  key: string;
  name: string;
  status: PhaseStatus;
}

export interface StreamInfo {
  index: number;
  label: string;
  task: string;
  status: StreamStatus;
}

export interface LogEntry {
  time: Date;
  message: string;
  level: "info" | "warn" | "error";
}

export interface ActiveAgentInfo {
  label: string;
  model: string;
  startedAt: number;
}

const PHASE_NAMES: Record<string, string> = {
  spec: "PM Drafting",
  decompose: "Decomposition",
  design: "Design",
  implement: "Implementation",
  "cross-model-review": "Cross-Model Review",
  verify: "Verification",
  "task-prereqs": "Pre-Analysis",
  "task-clarify": "PM Review",
  "plan-prereqs": "Pre-Analysis",
  "plan-clarify": "Requirements Clarification",
  "plan-eng-clarify": "Engineer Clarification",
  "plan-design-clarify": "Designer Clarification",
  "plan-review": "Plan Review",
  "plan-cross-review": "Cross-Model Review",
  "plan-analyze": "Technical Analysis",
  "analyze-scout": "Scout",
  "analyze-chunk": "Chunk Analysis",
  "analyze-synthesis": "Synthesis",
  "analyze-architect": "Architecture Analysis",
  "analyze-review": "Peer Review",
};

const MAX_LOG_ENTRIES = 100;
/** Grace period before removing a model from the active display (ms). */
const MODEL_GRACE_MS = 2_000;

export class ProgressTracker {
  phases: PhaseInfo[] = [];
  streams: StreamInfo[] = [];
  activeAgent: string | null = null;
  startTime = Date.now();
  logs: LogEntry[] = [];
  runId = "";
  primaryModel = "";
  reviewModel = "";
  version = "";
  cwd = "";
  private readonly _activeModels = new Map<string, number>();
  private readonly _modelGrace = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _activeAgentSessions = new Map<string, ActiveAgentInfo>();

  /** Register an active agent session (shown in TUI right column). */
  addActiveAgent(sessionId: string, label: string, model: string): void {
    this._activeAgentSessions.set(sessionId, { label, model, startedAt: Date.now() });
    this.addActiveModel(model);
  }

  /** Remove an agent session (e.g. on destroy). */
  removeActiveAgent(sessionId: string): void {
    const info = this._activeAgentSessions.get(sessionId);
    if (info) {
      this._activeAgentSessions.delete(sessionId);
      this.removeActiveModel(info.model);
    }
  }

  /** Currently running agents with their models. */
  get activeAgentList(): ActiveAgentInfo[] {
    return [...this._activeAgentSessions.values()];
  }

  addActiveModel(model: string): void {
    // Cancel any pending grace-period removal
    const timer = this._modelGrace.get(model);
    if (timer) {
      clearTimeout(timer);
      this._modelGrace.delete(model);
    }
    this._activeModels.set(model, (this._activeModels.get(model) ?? 0) + 1);
  }

  removeActiveModel(model: string): void {
    const count = this._activeModels.get(model) ?? 0;
    if (count <= 1) {
      this._activeModels.delete(model);
      // Keep model visible briefly to prevent header flickering between sessions
      const timer = setTimeout(() => this._modelGrace.delete(model), MODEL_GRACE_MS);
      timer.unref();
      this._modelGrace.set(model, timer);
    } else {
      this._activeModels.set(model, count - 1);
    }
  }

  get activeModels(): string[] {
    const models = new Set<string>();
    for (const m of this._activeModels.keys()) models.add(m);
    for (const m of this._modelGrace.keys()) models.add(m);
    return [...models];
  }

  initPhases(phaseConfigs: readonly { phase: string }[]): void {
    this.phases = phaseConfigs.map((p, i) => ({
      key: `${p.phase}-${i}`,
      name: PHASE_NAMES[p.phase] ?? p.phase,
      status: "pending" as PhaseStatus,
    }));
  }

  activatePhase(key: string): void {
    for (const p of this.phases) {
      if (p.key === key) p.status = "active";
    }
  }

  completePhase(key: string): void {
    for (const p of this.phases) {
      if (p.key === key) p.status = "done";
    }
  }

  skipPhase(key: string): void {
    for (const p of this.phases) {
      if (p.key === key) p.status = "skipped";
    }
  }

  initStreams(tasks: string[]): void {
    this.streams = tasks.map((task, i) => ({
      index: i,
      label: `S${i + 1}`,
      task,
      status: "queued" as StreamStatus,
    }));
  }

  updateStream(index: number, status: StreamStatus): void {
    if (this.streams[index]) {
      this.streams[index].status = status;
    }
  }

  setActiveAgent(agent: string | null): void {
    this.activeAgent = agent;
  }

  addLog(message: string, level: LogEntry["level"] = "info"): void {
    this.logs.push({ time: new Date(), message, level });
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }
  }

  get completedPhaseCount(): number {
    return this.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  }

  get totalPhaseCount(): number {
    return this.phases.length;
  }

  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
