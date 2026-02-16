import { describe, expect, it } from "vitest";
import { ProgressTracker } from "./progress-tracker.js";

describe("ProgressTracker", () => {
  it("initializes phases from pipeline config", () => {
    const tracker = new ProgressTracker();
    tracker.initPhases([{ phase: "spec" }, { phase: "decompose" }, { phase: "implement" }]);
    expect(tracker.phases).toHaveLength(3);
    expect(tracker.phases[0]).toEqual({
      key: "spec-0",
      name: "PM Drafting",
      status: "pending",
    });
    expect(tracker.phases[2]).toEqual({
      key: "implement-2",
      name: "Implementation",
      status: "pending",
    });
  });

  it("tracks phase status transitions", () => {
    const tracker = new ProgressTracker();
    tracker.initPhases([{ phase: "spec" }, { phase: "decompose" }]);

    tracker.activatePhase("spec-0");
    expect(tracker.phases[0].status).toBe("active");

    tracker.completePhase("spec-0");
    expect(tracker.phases[0].status).toBe("done");
    expect(tracker.completedPhaseCount).toBe(1);

    tracker.skipPhase("decompose-1");
    expect(tracker.phases[1].status).toBe("skipped");
    expect(tracker.completedPhaseCount).toBe(2);
  });

  it("initializes and updates stream status", () => {
    const tracker = new ProgressTracker();
    tracker.initStreams(["Task A", "Task B", "Task C"]);

    expect(tracker.streams).toHaveLength(3);
    expect(tracker.streams[0]).toEqual({
      index: 0,
      label: "S1",
      task: "Task A",
      status: "queued",
    });

    tracker.updateStream(0, "engineering");
    expect(tracker.streams[0].status).toBe("engineering");

    tracker.updateStream(0, "reviewing");
    expect(tracker.streams[0].status).toBe("reviewing");

    tracker.updateStream(0, "done");
    expect(tracker.streams[0].status).toBe("done");

    tracker.updateStream(1, "failed");
    expect(tracker.streams[1].status).toBe("failed");
  });

  it("ignores out-of-range stream updates", () => {
    const tracker = new ProgressTracker();
    tracker.initStreams(["Task A"]);
    tracker.updateStream(5, "done");
    expect(tracker.streams).toHaveLength(1);
  });

  it("tracks active agent", () => {
    const tracker = new ProgressTracker();
    expect(tracker.activeAgent).toBeNull();

    tracker.setActiveAgent("pm is working…");
    expect(tracker.activeAgent).toBe("pm is working…");

    tracker.setActiveAgent(null);
    expect(tracker.activeAgent).toBeNull();
  });

  it("manages log entries with cap", () => {
    const tracker = new ProgressTracker();

    tracker.addLog("info message");
    tracker.addLog("warn message", "warn");
    tracker.addLog("error message", "error");

    expect(tracker.logs).toHaveLength(3);
    expect(tracker.logs[0].level).toBe("info");
    expect(tracker.logs[1].level).toBe("warn");
    expect(tracker.logs[2].level).toBe("error");

    // Fill beyond cap (100)
    for (let i = 0; i < 110; i++) {
      tracker.addLog(`log ${i}`);
    }
    expect(tracker.logs.length).toBeLessThanOrEqual(100);
  });

  it("calculates elapsed time", () => {
    const tracker = new ProgressTracker();
    tracker.startTime = Date.now() - 5000;
    expect(tracker.elapsedMs).toBeGreaterThanOrEqual(4900);
  });

  it("uses fallback name for unknown phase types", () => {
    const tracker = new ProgressTracker();
    tracker.initPhases([{ phase: "custom-phase" }]);
    expect(tracker.phases[0].name).toBe("custom-phase");
  });
});
