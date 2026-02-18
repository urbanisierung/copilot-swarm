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

const PHASE_NAMES: Record<string, string> = {
  spec: "PM Drafting",
  decompose: "Decomposition",
  design: "Design",
  implement: "Implementation",
  "cross-model-review": "Cross-Model Review",
  verify: "Verification",
  "plan-clarify": "Requirements Clarification",
  "plan-eng-clarify": "Engineer Clarification",
  "plan-design-clarify": "Designer Clarification",
  "plan-review": "Plan Review",
  "plan-cross-review": "Cross-Model Review",
  "plan-analyze": "Technical Analysis",
  "analyze-architect": "Architecture Analysis",
  "analyze-review": "Peer Review",
};

const MAX_LOG_ENTRIES = 100;

export class ProgressTracker {
  phases: PhaseInfo[] = [];
  streams: StreamInfo[] = [];
  activeAgent: string | null = null;
  startTime = Date.now();
  logs: LogEntry[] = [];
  runId = "";
  primaryModel = "";
  reviewModel = "";

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
