/**
 * Resolve a GitHub issue reference to its title + body using the `gh` CLI.
 * Supported formats:
 *   gh:owner/repo#123
 *   gh:#123              (uses current repo)
 *   https://github.com/owner/repo/issues/123
 */
import { execSync } from "node:child_process";

const PATTERNS: [RegExp, (m: RegExpMatchArray) => { nwo: string; number: string }][] = [
  [/^gh:([^#]+)#(\d+)$/, (m) => ({ nwo: m[1], number: m[2] })],
  [/^gh:#(\d+)$/, (m) => ({ nwo: "", number: m[1] })],
  [/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/, (m) => ({ nwo: m[1], number: m[2] })],
];

/**
 * If `input` matches a known GitHub issue pattern, fetch the issue and return
 * its formatted content. Returns `undefined` for non-matching input.
 */
export function resolveGitHubIssue(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  for (const [pattern, extract] of PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const { nwo, number } = extract(match);
    return fetchIssue(nwo, number, trimmed);
  }
  return undefined;
}

function fetchIssue(nwo: string, number: string, ref: string): string {
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    console.error("Error: GitHub CLI (gh) is required to fetch issues. Install it from https://cli.github.com/");
    process.exit(1);
  }

  try {
    const repoFlag = nwo ? ` --repo ${nwo}` : "";
    const cmd = `gh issue view ${number}${repoFlag} --json title,body`;
    const result = execSync(cmd, { encoding: "utf-8" });
    const issue: { title: string; body: string } = JSON.parse(result);
    return `# ${issue.title}\n\n${issue.body}`;
  } catch {
    console.error(`Error: Failed to fetch GitHub issue "${ref}". Make sure you're authenticated (gh auth login).`);
    process.exit(1);
  }
}
