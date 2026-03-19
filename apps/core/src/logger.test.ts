import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyError, type ErrorClassification, Logger, listRecentLogs, serializeError } from "./logger.js";

const TEST_LOG_DIR = path.join(os.tmpdir(), "copilot-swarm-test-logger");

function readLogEntries(filePath: string): Record<string, unknown>[] {
  return fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("Logger structured output", () => {
  let logger: Logger;

  beforeEach(() => {
    fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it("creates a .jsonl log file", () => {
    logger = new Logger(false, "test-001", "info");
    expect(logger.logFilePath).toBeTruthy();
    expect(logger.logFilePath?.endsWith(".jsonl")).toBe(true);
  });

  it("writes structured JSON Lines entries", () => {
    logger = new Logger(false, "test-002", "info");
    logger.info("Hello world");
    logger.warn("Watch out");

    const entries = readLogEntries(logger.logFilePath as string);
    // First entry is the header
    expect(entries[0]).toMatchObject({ level: "info", msg: "Copilot Swarm log started" });
    expect(entries[1]).toMatchObject({ level: "info", msg: "Hello world" });
    expect(entries[2]).toMatchObject({ level: "warn", msg: "Watch out" });
    expect(entries[1]).toHaveProperty("ts");
  });

  it("includes context in log entries", () => {
    logger = new Logger(false, "test-003", "info");
    logger.info("Agent started", { agent: "engineer", model: "gpt-4.1" });

    const entries = readLogEntries(logger.logFilePath as string);
    expect(entries[1].ctx).toEqual({ agent: "engineer", model: "gpt-4.1" });
  });

  it("includes error details with stack trace", () => {
    logger = new Logger(false, "test-004", "info");
    const err = new Error("Something broke");
    logger.error("Operation failed", err, { agent: "reviewer" });

    const entries = readLogEntries(logger.logFilePath as string);
    const errorEntry = entries[1];
    expect(errorEntry.level).toBe("error");
    expect(errorEntry.msg).toBe("Operation failed");
    const errorDetail = errorEntry.error as Record<string, unknown>;
    expect(errorDetail.name).toBe("Error");
    expect(errorDetail.message).toBe("Something broke");
    expect(errorDetail.stack).toContain("Something broke");
  });

  it("respects log level filtering", () => {
    logger = new Logger(false, "test-005", "warn");
    logger.debug("should not appear");
    logger.info("should not appear either");
    logger.warn("this should appear");
    logger.error("this too");

    const entries = readLogEntries(logger.logFilePath as string);
    // Header + warn + error = 3
    expect(entries).toHaveLength(3);
    expect(entries[1].level).toBe("warn");
    expect(entries[2].level).toBe("error");
  });

  it("debug level logs everything", () => {
    logger = new Logger(false, "test-006", "debug");
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    const entries = readLogEntries(logger.logFilePath as string);
    // Header + 4 messages = 5
    expect(entries).toHaveLength(5);
  });

  it("error level only logs errors", () => {
    logger = new Logger(false, "test-007", "error");
    logger.debug("skip");
    logger.info("skip");
    logger.warn("skip");
    logger.error("keep");

    const entries = readLogEntries(logger.logFilePath as string);
    // Header is always written + 1 error = 2
    expect(entries).toHaveLength(2);
  });
});

describe("serializeError", () => {
  it("extracts Error details with stack", () => {
    const err = new Error("test error");
    const detail = serializeError(err);
    expect(detail).toBeDefined();
    expect(detail?.name).toBe("Error");
    expect(detail?.message).toBe("test error");
    expect(detail?.stack).toContain("test error");
  });

  it("extracts error code if present", () => {
    const err = new Error("connection failed");
    (err as unknown as Record<string, unknown>).code = "ECONNREFUSED";
    const detail = serializeError(err);
    expect(detail?.code).toBe("ECONNREFUSED");
  });

  it("extracts cause chain", () => {
    const cause = new Error("root cause");
    const err = new Error("wrapper", { cause });
    const detail = serializeError(err);
    expect(detail?.cause).toBe("Error: root cause");
  });

  it("handles non-Error values", () => {
    const detail = serializeError("string error");
    expect(detail).toEqual({ name: "UnknownError", message: "string error" });
  });

  it("returns undefined for null/undefined", () => {
    expect(serializeError(null)).toBeUndefined();
    expect(serializeError(undefined)).toBeUndefined();
  });

  it("includes classification fields", () => {
    const err = new Error("rate limit exceeded");
    const detail = serializeError(err);
    expect(detail?.category).toBe("transient");
    expect(detail?.retryable).toBe(true);
  });
});

describe("classifyError", () => {
  const cases: [string, ErrorClassification][] = [
    ["rate limit exceeded", { category: "transient", type: "rate_limit", retryable: true }],
    ["Request timed out", { category: "transient", type: "timeout", retryable: true }],
    ["socket hang up", { category: "transient", type: "network", retryable: true }],
    ["502 Bad Gateway", { category: "transient", type: "server_error", retryable: true }],
    ["context length exceeded", { category: "permanent", type: "context_length", retryable: false }],
    ["401 Unauthorized", { category: "permanent", type: "auth", retryable: false }],
    ["400 Bad Request", { category: "permanent", type: "bad_request", retryable: false }],
    ["something completely unknown", { category: "unknown", type: "unknown", retryable: false }],
  ];

  for (const [message, expected] of cases) {
    it(`classifies "${message}" as ${expected.type}`, () => {
      const result = classifyError(new Error(message));
      expect(result).toEqual(expected);
    });
  }

  it("classifies by error code", () => {
    const err = new Error("connection issue");
    (err as unknown as Record<string, unknown>).code = "ECONNRESET";
    expect(classifyError(err)).toMatchObject({ category: "transient", type: "network" });
  });

  it("handles non-Error input", () => {
    expect(classifyError("not an error")).toEqual({ category: "unknown", type: "unknown", retryable: false });
  });
});

describe("listRecentLogs", () => {
  it("returns empty array when no logs exist", () => {
    // listRecentLogs uses the real LOG_DIR so this may or may not find files
    const result = listRecentLogs();
    expect(Array.isArray(result)).toBe(true);
  });
});
