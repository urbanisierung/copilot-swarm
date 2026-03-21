import { describe, expect, it, type MockInstance, vi } from "vitest";
import { formatHelpText, loadConfig } from "./config.js";

const SAMPLE_HELP = `Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode

Options:
  -v, --verbose        Enable verbose streaming output
  --log-level <level>  Set log level: error, warn, info (default), debug
  -p, --plan <file>    Use a plan file as input
  -h, --help           Show this help message

Prompt sources (first match wins):
  --plan <file>        Extract refined requirements from a plan file
  "<prompt>"           Inline text argument
  gh:owner/repo#123    Fetch a GitHub issue (requires gh CLI)

Examples:
  swarm "Add a dark mode toggle"
  swarm auto "Add dark mode"       Plan + run without interaction

Environment variables override defaults; CLI args override env vars.
See documentation for all env var options.`;

// Fake TTY stream for testing
function fakeTTY(): NodeJS.WriteStream {
  return { isTTY: true } as NodeJS.WriteStream;
}

function fakeNonTTY(): NodeJS.WriteStream {
  return { isTTY: false } as NodeJS.WriteStream;
}

describe("formatHelpText", () => {
  it("returns plain text for non-TTY streams", () => {
    expect(formatHelpText(SAMPLE_HELP, fakeNonTTY())).toBe(SAMPLE_HELP);
  });

  it("returns plain text when NO_COLOR is set", () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = "";
    try {
      expect(formatHelpText(SAMPLE_HELP, fakeTTY())).toBe(SAMPLE_HELP);
    } finally {
      if (original === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = original;
    }
  });

  it("applies bold to Usage line", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain('\x1b[1mUsage: swarm [command] [options] "<prompt>"\x1b[22m');
  });

  it("applies bold to section headers", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[1mCommands:\x1b[22m");
    expect(result).toContain("\x1b[1mOptions:\x1b[22m");
    expect(result).toContain("\x1b[1mExamples:\x1b[22m");
    expect(result).toContain("\x1b[1mPrompt sources (first match wins):\x1b[22m");
  });

  it("applies green to command names", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[32mrun\x1b[39m");
    expect(result).toContain("\x1b[32mplan\x1b[39m");
  });

  it("applies yellow to option flags", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[33m-v, --verbose\x1b[39m");
    expect(result).toContain("\x1b[33m-h, --help\x1b[39m");
    expect(result).toContain("\x1b[33m--log-level\x1b[39m");
  });

  it("applies cyan to parameter placeholders", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[36m <level>\x1b[39m");
    expect(result).toContain("\x1b[36m <file>\x1b[39m");
  });

  it("applies cyan to example commands", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain('\x1b[36mswarm "Add a dark mode toggle"\x1b[39m');
  });

  it("applies dim to example comments", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[2mPlan + run without interaction\x1b[22m");
  });

  it("applies dim to footer text", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\x1b[2mEnvironment variables override defaults; CLI args override env vars.\x1b[22m");
  });

  it("applies cyan to prompt source entries", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain('\x1b[36m"<prompt>"\x1b[39m');
    expect(result).toContain("\x1b[36mgh:owner/repo#123\x1b[39m");
  });

  it("preserves empty lines", () => {
    const result = formatHelpText(SAMPLE_HELP, fakeTTY());
    expect(result).toContain("\n\n");
  });
});

describe("no-prompt fallback path", () => {
  let origArgv: string[];
  let origIssueBody: string | undefined;
  let origNoColor: string | undefined;
  let origStderrIsTTY: boolean | undefined;
  let errorSpy: MockInstance;
  let exitSpy: MockInstance;

  function setup() {
    origArgv = process.argv;
    origIssueBody = process.env.ISSUE_BODY;
    origNoColor = process.env.NO_COLOR;
    origStderrIsTTY = process.stderr.isTTY;

    process.argv = ["node", "swarm"];
    delete process.env.ISSUE_BODY;

    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  }

  function teardown() {
    process.argv = origArgv;
    if (origIssueBody === undefined) delete process.env.ISSUE_BODY;
    else process.env.ISSUE_BODY = origIssueBody;
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    Object.defineProperty(process.stderr, "isTTY", {
      value: origStderrIsTTY,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  }

  it("emits ANSI-formatted help text when stderr is TTY", async () => {
    setup();
    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stderr, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      await expect(loadConfig()).rejects.toThrow("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledOnce();

      const msg = errorSpy.mock.calls[0][0] as string;
      expect(msg).toContain("Error: No prompt provided");
      // TTY + no NO_COLOR → ANSI bold codes present
      expect(msg).toContain("\x1b[1m");
    } finally {
      teardown();
    }
  });

  it("emits plain help text when stderr is not TTY", async () => {
    setup();
    try {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stderr, "isTTY", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await expect(loadConfig()).rejects.toThrow("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledOnce();

      const msg = errorSpy.mock.calls[0][0] as string;
      expect(msg).toContain("Error: No prompt provided");
      // Non-TTY → no ANSI codes
      expect(msg).not.toContain("\x1b[");
    } finally {
      teardown();
    }
  });

  it("emits plain help text when NO_COLOR is set", async () => {
    setup();
    try {
      process.env.NO_COLOR = "";
      Object.defineProperty(process.stderr, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      await expect(loadConfig()).rejects.toThrow("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledOnce();

      const msg = errorSpy.mock.calls[0][0] as string;
      expect(msg).toContain("Error: No prompt provided");
      // NO_COLOR set → no ANSI codes even on TTY
      expect(msg).not.toContain("\x1b[");
    } finally {
      teardown();
    }
  });
});
