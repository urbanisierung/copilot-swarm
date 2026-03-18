import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = resolve(__dirname, "../../../apps/core/CHANGELOG.md");
const target = resolve(__dirname, "../src/content/docs/changelog.md");

const raw = await readFile(source, "utf-8");

// Strip the package-scoped title (e.g. "# @copilot-swarm/core") and add Starlight frontmatter
const content = raw.replace(/^#\s+@copilot-swarm\/core\s*\n*/, "");

const frontmatter = `---
title: Changelog
description: Release history for Copilot Swarm.
---

`;

await mkdir(dirname(target), { recursive: true });
await writeFile(target, frontmatter + content);

console.log("✔ Synced changelog to docs");
