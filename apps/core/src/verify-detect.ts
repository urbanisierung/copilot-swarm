/**
 * Auto-detect verification commands from project files.
 * Scans for common build tool markers and infers build/test/lint commands.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { VerifyConfig } from "./pipeline-types.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function detectFromPackageJson(repoRoot: string): VerifyConfig | null {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = readJson(pkgPath) as PackageJson | null;
  if (!pkg?.scripts) return { build: undefined, test: undefined, lint: undefined };

  const scripts = pkg.scripts;
  const build = scripts.build ? "npm run build" : undefined;
  const test = scripts.test ? "npm test" : undefined;

  // Check common lint/check script names
  let lint: string | undefined;
  if (scripts.lint) lint = "npm run lint";
  else if (scripts.check) lint = "npm run check";

  if (!build && !test && !lint) return null;
  return { build, test, lint };
}

function detectFromCargo(repoRoot: string): VerifyConfig | null {
  if (!fs.existsSync(path.join(repoRoot, "Cargo.toml"))) return null;
  return { build: "cargo build", test: "cargo test", lint: "cargo clippy" };
}

function detectFromGo(repoRoot: string): VerifyConfig | null {
  if (!fs.existsSync(path.join(repoRoot, "go.mod"))) return null;
  return { build: "go build ./...", test: "go test ./...", lint: "go vet ./..." };
}

function detectFromPython(repoRoot: string): VerifyConfig | null {
  const hasPyproject = fs.existsSync(path.join(repoRoot, "pyproject.toml"));
  const hasSetupPy = fs.existsSync(path.join(repoRoot, "setup.py"));
  if (!hasPyproject && !hasSetupPy) return null;
  return { build: undefined, test: "pytest", lint: "ruff check ." };
}

function detectFromMaven(repoRoot: string): VerifyConfig | null {
  if (!fs.existsSync(path.join(repoRoot, "pom.xml"))) return null;
  return { build: "mvn compile", test: "mvn test", lint: undefined };
}

function detectFromGradle(repoRoot: string): VerifyConfig | null {
  const hasGroovy = fs.existsSync(path.join(repoRoot, "build.gradle"));
  const hasKotlin = fs.existsSync(path.join(repoRoot, "build.gradle.kts"));
  if (!hasGroovy && !hasKotlin) return null;
  return { build: "./gradlew build", test: "./gradlew test", lint: undefined };
}

const DETECTORS = [
  detectFromPackageJson,
  detectFromCargo,
  detectFromGo,
  detectFromPython,
  detectFromMaven,
  detectFromGradle,
];

/**
 * Scan the repo root for project files and infer verification commands.
 * Returns null if no recognizable project structure is found.
 */
export function detectVerifyCommands(repoRoot: string): VerifyConfig | null {
  for (const detect of DETECTORS) {
    const result = detect(repoRoot);
    if (result) return result;
  }
  return null;
}
