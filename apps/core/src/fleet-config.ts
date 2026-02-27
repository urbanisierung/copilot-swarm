import * as fs from "node:fs";
import * as path from "node:path";
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
    fail(`Fleet config not found: ${resolved}`);
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
        fail(`Repository path does not exist: ${resolved}`);
      }
      const name = path.basename(resolved);
      return { path: resolved, role: name };
    }),
  };
}
