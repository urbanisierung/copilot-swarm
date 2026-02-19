import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectVerifyCommands } from "./verify-detect.js";

describe("detectVerifyCommands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-detect-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no project files exist", () => {
    expect(detectVerifyCommands(tmpDir)).toBeNull();
  });

  it("detects package.json with build and test scripts (npm default)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } }),
    );
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "npm run build", test: "npm run test", lint: undefined });
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run", lint: "eslint ." } }),
    );
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "pnpm run build", test: "pnpm run test", lint: "pnpm run lint" });
  });

  it("detects yarn from yarn.lock", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { build: "tsc", test: "jest" } }));
    fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "yarn run build", test: "yarn run test", lint: undefined });
  });

  it("detects bun from bun.lockb", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "bun test" } }),
    );
    fs.writeFileSync(path.join(tmpDir, "bun.lockb"), "");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "bun run build", test: "bun run test", lint: undefined });
  });

  it("detects package.json with lint script", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", lint: "eslint ." } }),
    );
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "npm run build", test: undefined, lint: "npm run lint" });
  });

  it("detects package.json with check script (alternative lint)", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { check: "biome check ." } }));
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: undefined, test: undefined, lint: "npm run check" });
  });

  it("returns null for package.json without any relevant scripts", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    expect(detectVerifyCommands(tmpDir)).toBeNull();
  });

  it("detects Cargo.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "[package]\nname = 'test'\n");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "cargo build", test: "cargo test", lint: "cargo clippy" });
  });

  it("detects go.mod", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module test\n");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "go build ./...", test: "go test ./...", lint: "go vet ./..." });
  });

  it("detects pyproject.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[project]\nname = 'test'\n");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: undefined, test: "pytest", lint: "ruff check ." });
  });

  it("detects pom.xml", () => {
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project></project>");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "mvn compile", test: "mvn test", lint: undefined });
  });

  it("detects build.gradle", () => {
    fs.writeFileSync(path.join(tmpDir, "build.gradle"), "apply plugin: 'java'");
    const result = detectVerifyCommands(tmpDir);
    expect(result).toEqual({ build: "./gradlew build", test: "./gradlew test", lint: undefined });
  });

  it("prefers package.json over Cargo.toml (first match)", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "[package]\nname = 'test'\n");
    const result = detectVerifyCommands(tmpDir);
    expect(result?.build).toBe("npm run build");
  });
});
