import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filterIgnoredFiles, repoLabel } from "./compare-engine.js";

// --- repoLabel ---

describe("repoLabel", () => {
  it("returns A for index 0", () => {
    expect(repoLabel(0)).toBe("A");
  });

  it("returns B for index 1", () => {
    expect(repoLabel(1)).toBe("B");
  });

  it("returns C for index 2", () => {
    expect(repoLabel(2)).toBe("C");
  });

  it("handles higher indices", () => {
    expect(repoLabel(25)).toBe("Z");
  });
});

// --- filterIgnoredFiles ---

describe("filterIgnoredFiles", () => {
  it("removes .github/ files", () => {
    const input = ["src/index.ts", ".github/workflows/ci.yml", ".github/CODEOWNERS"];
    expect(filterIgnoredFiles(input)).toEqual(["src/index.ts"]);
  });

  it("removes node_modules/ files", () => {
    const input = ["src/app.ts", "node_modules/lodash/index.js"];
    expect(filterIgnoredFiles(input)).toEqual(["src/app.ts"]);
  });

  it("removes dist/ and build/ files", () => {
    const input = ["src/main.ts", "dist/main.js", "build/output.js"];
    expect(filterIgnoredFiles(input)).toEqual(["src/main.ts"]);
  });

  it("removes lock files", () => {
    const input = ["src/a.ts", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("removes .vscode/ and .idea/ files", () => {
    const input = ["src/a.ts", ".vscode/settings.json", ".idea/workspace.xml"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("removes .turbo/ and .next/ files", () => {
    const input = ["src/a.ts", ".turbo/cache.json", ".next/build-manifest.json"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("removes coverage/ files", () => {
    const input = ["src/a.ts", "coverage/lcov.info"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("removes .DS_Store", () => {
    const input = ["src/a.ts", ".DS_Store"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("removes .swarm/ files", () => {
    const input = ["src/a.ts", ".swarm/sessions/data.json"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("preserves legitimate source files", () => {
    const input = ["src/index.ts", "src/utils.ts", "tests/utils.test.ts", "README.md", "package.json", "tsconfig.json"];
    expect(filterIgnoredFiles(input)).toEqual(input);
  });

  it("handles empty input", () => {
    expect(filterIgnoredFiles([])).toEqual([]);
  });

  it("handles backslash paths (Windows-style)", () => {
    const input = ["src\\index.ts", ".github\\workflows\\ci.yml", "node_modules\\lodash\\index.js"];
    expect(filterIgnoredFiles(input)).toEqual(["src\\index.ts"]);
  });

  it("removes nested ignored directories", () => {
    const input = ["src/a.ts", "packages/ui/node_modules/react/index.js", "apps/web/.next/static/file.js"];
    expect(filterIgnoredFiles(input)).toEqual(["src/a.ts"]);
  });

  it("handles multiple ignored patterns in one list", () => {
    const input = [
      "src/app.ts",
      ".github/workflows/ci.yml",
      "node_modules/lodash/index.js",
      "dist/bundle.js",
      ".vscode/settings.json",
      "coverage/lcov.info",
      "pnpm-lock.yaml",
      "tests/app.test.ts",
    ];
    expect(filterIgnoredFiles(input)).toEqual(["src/app.ts", "tests/app.test.ts"]);
  });
});

// --- Git-based integration tests ---

describe("compare git integration", () => {
  let tmpDir: string;
  let leftRepo: string;
  let rightRepo: string;

  function git(cwd: string, cmd: string): string {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-test-"));
    // Create a bare "origin" so we can set up two clones with branches
    const originDir = path.join(tmpDir, "origin");
    fs.mkdirSync(originDir);
    git(originDir, "init --bare");

    // Create left repo
    leftRepo = path.join(tmpDir, "left");
    fs.mkdirSync(leftRepo);
    git(leftRepo, "init");
    git(leftRepo, "config user.email test@test.com");
    git(leftRepo, "config user.name Test");
    fs.writeFileSync(path.join(leftRepo, "README.md"), "# Base\n");
    git(leftRepo, "add .");
    git(leftRepo, 'commit -m "initial"');
    git(leftRepo, "branch -M main");
    // Create a feature branch with changes
    git(leftRepo, "checkout -b feature");
    fs.mkdirSync(path.join(leftRepo, "src"), { recursive: true });
    fs.writeFileSync(path.join(leftRepo, "src", "index.ts"), "export const a = 1;\n");
    fs.mkdirSync(path.join(leftRepo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(leftRepo, ".github", "workflows", "ci.yml"), "name: CI\n");
    git(leftRepo, "add .");
    git(leftRepo, 'commit -m "left changes"');

    // Create right repo
    rightRepo = path.join(tmpDir, "right");
    fs.mkdirSync(rightRepo);
    git(rightRepo, "init");
    git(rightRepo, "config user.email test@test.com");
    git(rightRepo, "config user.name Test");
    fs.writeFileSync(path.join(rightRepo, "README.md"), "# Base\n");
    git(rightRepo, "add .");
    git(rightRepo, 'commit -m "initial"');
    git(rightRepo, "branch -M main");
    git(rightRepo, "checkout -b feature");
    fs.mkdirSync(path.join(rightRepo, "lib"), { recursive: true });
    fs.writeFileSync(path.join(rightRepo, "lib", "utils.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(rightRepo, "lib", "helpers.ts"), "export const c = 3;\n");
    git(rightRepo, "add .");
    git(rightRepo, 'commit -m "right changes"');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects changed files via git diff", () => {
    const output = execSync("git diff --name-only main..HEAD", {
      cwd: leftRepo,
      encoding: "utf-8",
    }).trim();
    const files = output.split("\n").filter(Boolean);
    expect(files).toContain("src/index.ts");
    expect(files).toContain(".github/workflows/ci.yml");
  });

  it("filterIgnoredFiles removes .github from git diff results", () => {
    const output = execSync("git diff --name-only main..HEAD", {
      cwd: leftRepo,
      encoding: "utf-8",
    }).trim();
    const files = output.split("\n").filter(Boolean);
    const filtered = filterIgnoredFiles(files);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).not.toContain(".github/workflows/ci.yml");
  });

  it("detects right repo changes", () => {
    const output = execSync("git diff --name-only main..HEAD", {
      cwd: rightRepo,
      encoding: "utf-8",
    }).trim();
    const files = output.split("\n").filter(Boolean);
    const filtered = filterIgnoredFiles(files);
    expect(filtered).toEqual(expect.arrayContaining(["lib/utils.ts", "lib/helpers.ts"]));
  });
});
