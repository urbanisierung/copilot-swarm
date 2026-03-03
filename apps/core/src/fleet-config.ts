import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parse as parseYaml } from "yaml";
import type { FleetConfig, FleetRepo, FleetRepoOverrides } from "./fleet-types.js";

const FLEET_CONFIG_FILE = "fleet.config.yaml";

function fail(msg: string): never {
  throw new Error(`Fleet config error: ${msg}`);
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val === "") {
    fail(`"${key}" must be a non-empty string in ${context}`);
  }
  return val;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") fail(`"${key}" must be a string if provided`);
  return val;
}

function resolveRepoPath(rawPath: string): string {
  const expanded = rawPath.replace(/^~(?=\/|$)/, process.env.HOME ?? "");
  return path.resolve(expanded);
}

function validateRepo(raw: unknown, index: number): FleetRepo {
  if (typeof raw !== "object" || raw === null) fail(`repos[${index}] must be an object`);
  const obj = raw as Record<string, unknown>;
  const rawPath = requireString(obj, "path", `repos[${index}]`);
  const resolved = resolveRepoPath(rawPath);
  if (!fs.existsSync(resolved)) {
    fail(`repos[${index}].path does not exist: ${resolved}`);
  }
  return {
    path: resolved,
    role: requireString(obj, "role", `repos[${index}]`),
  };
}

function validateOverrides(raw: unknown): Record<string, FleetRepoOverrides> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) fail('"overrides" must be an object if provided');
  const result: Record<string, FleetRepoOverrides> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) fail(`overrides["${key}"] must be an object`);
    const obj = value as Record<string, unknown>;
    result[resolveRepoPath(key)] = {
      verifyBuild: optionalString(obj, "verifyBuild"),
      verifyTest: optionalString(obj, "verifyTest"),
      verifyLint: optionalString(obj, "verifyLint"),
    };
  }
  return result;
}

export function parseFleetConfig(raw: unknown): FleetConfig {
  if (typeof raw !== "object" || raw === null) {
    fail("Config must be a YAML object");
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    fail('"repos" must be a non-empty array');
  }

  return {
    repos: (obj.repos as unknown[]).map((r, i) => validateRepo(r, i)),
    overrides: validateOverrides(obj.overrides),
    integrationTest: optionalString(obj, "integrationTest"),
  };
}

/** Load fleet config from a file path or the current directory. */
export function loadFleetConfig(configPath?: string): FleetConfig {
  const resolved = configPath ? path.resolve(configPath) : path.resolve(FLEET_CONFIG_FILE);

  if (!fs.existsSync(resolved)) {
    fail(
      `Fleet config not found: ${resolved}\n\n` +
        "To use fleet mode, provide repositories using one of:\n" +
        '  swarm fleet "prompt" ./repo1 ./repo2           Positional repo paths\n' +
        '  swarm fleet "prompt" --repos ./repo1 --repos ./repo2\n' +
        '  swarm fleet "prompt" --fleet-config config.yaml\n\n' +
        "Example fleet.config.yaml:\n" +
        "  repos:\n" +
        '    - path: ./auth-service\n      role: "Auth backend"\n' +
        '    - path: ./frontend\n      role: "React frontend"\n\n' +
        "Run 'swarm --help' or see doc/documentation.md for details.",
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(resolved, "utf-8"));
  } catch (err) {
    fail(`Failed to parse ${resolved}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return parseFleetConfig(parsed);
}

/** Build a FleetConfig from CLI --repos arguments. */
export function fleetConfigFromArgs(repoPaths: string[]): FleetConfig {
  return {
    repos: repoPaths.map((p) => {
      const resolved = resolveRepoPath(p);
      if (!fs.existsSync(resolved)) {
        fail(`Repository path does not exist: ${resolved}\n  Check the path and try again.`);
      }
      const name = path.basename(resolved);
      return { path: resolved, role: name };
    }),
  };
}

/** Scan a directory for immediate subdirectories that are git repositories. */
export function discoverGitRepos(baseDir: string): string[] {
  const resolved = path.resolve(baseDir);
  if (!fs.existsSync(resolved)) return [];

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const repos: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const full = path.join(resolved, entry.name);
    if (fs.existsSync(path.join(full, ".git"))) {
      repos.push(full);
    }
  }

  return repos.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/**
 * Interactive multi-select for git repositories.
 * Space to toggle, 'a' to select/unselect all, Enter to confirm.
 */
export async function selectReposInteractively(repos: string[]): Promise<string[]> {
  if (!process.stdin.isTTY) {
    fail("Interactive repo selection requires a TTY. Use --repos or fleet.config.yaml instead.");
  }

  const selected = new Set<number>(repos.map((_, i) => i));
  let cursor = 0;

  const render = () => {
    // Move cursor to start and clear
    process.stdout.write(`\x1b[${repos.length + 3}A\x1b[J`);
    process.stdout.write(
      "\x1b[1mSelect repositories\x1b[0m  (space: toggle, a: select/unselect all, enter: confirm)\n\n",
    );
    for (let i = 0; i < repos.length; i++) {
      const check = selected.has(i) ? "\x1b[32m✔\x1b[0m" : " ";
      const prefix = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
      process.stdout.write(`${prefix} [${check}] ${path.basename(repos[i])}\n`);
    }
    process.stdout.write(`\n  ${selected.size}/${repos.length} selected`);
  };

  // Initial draw — write placeholder lines so render() can clear them
  process.stdout.write("\n".repeat(repos.length + 3));
  render();

  return new Promise((resolve, reject) => {
    if (!process.stdin.setRawMode) {
      reject(new Error("Cannot enable raw mode on stdin"));
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    readline.emitKeypressEvents(process.stdin);

    const onKeypress = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      if (key.name === "c" && key.ctrl) {
        process.stdin.removeListener("keypress", onKeypress);
        cleanup();
        process.exit(130);
      }

      if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
        cursor = (cursor - 1 + repos.length) % repos.length;
      } else if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
        cursor = (cursor + 1) % repos.length;
      } else if (key.name === "space") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
      } else if (key.name === "a") {
        if (selected.size === repos.length) {
          selected.clear();
        } else {
          for (let i = 0; i < repos.length; i++) selected.add(i);
        }
      } else if (key.name === "return") {
        process.stdin.removeListener("keypress", onKeypress);
        cleanup();
        if (selected.size === 0) {
          reject(new Error("No repositories selected."));
          return;
        }
        resolve(repos.filter((_, i) => selected.has(i)));
        return;
      }

      render();
    };

    process.stdin.on("keypress", onKeypress);
  });
}
