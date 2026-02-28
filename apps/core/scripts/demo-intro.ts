#!/usr/bin/env npx tsx
/**
 * Interactive Copilot Swarm intro — guided walkthrough of CLI modes.
 *
 * Usage:
 *   npx tsx apps/core/scripts/demo-intro.ts
 *   pnpm demo:intro
 *   swarm demo
 */

import type { SwarmConfig } from "../src/config.js";
import { runDemo } from "../src/demo.js";

const mockConfig = {
  repoRoot: process.cwd(),
  swarmDir: ".swarm",
} as SwarmConfig;

runDemo(mockConfig).catch((err) => {
  console.error(err);
  process.exit(1);
});

