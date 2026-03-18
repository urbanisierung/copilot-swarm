import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.cpswarm.com",
  integrations: [
    starlight({
      title: "Copilot Swarm",
      description: "Multi-agent orchestrator for AI-powered development workflows",
      favicon: "/favicon.svg",
      logo: {
        dark: "./src/assets/logo-dark.svg",
        light: "./src/assets/logo-light.svg",
        replacesTitle: false,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/urbanisierung/copilot-swarm",
        },
        {
          icon: "x.com",
          label: "X",
          href: "https://x.com/urbanisierung",
        },
      ],
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Quick Start", slug: "getting-started/quickstart" },
            { label: "Installation", slug: "getting-started/installation" },
          ],
        },
        {
          label: "Commands",
          items: [
            { label: "Overview", slug: "commands/overview" },
            { label: "run", slug: "commands/run" },
            { label: "plan", slug: "commands/plan" },
            { label: "auto", slug: "commands/auto" },
            { label: "task", slug: "commands/task" },
            { label: "analyze", slug: "commands/analyze" },
            { label: "brainstorm", slug: "commands/brainstorm" },
            { label: "review", slug: "commands/review" },
            { label: "digest", slug: "commands/digest" },
            { label: "fleet", slug: "commands/fleet" },
            { label: "prepare", slug: "commands/prepare" },
            { label: "session", slug: "commands/session" },
            { label: "finish", slug: "commands/finish" },
            { label: "list", slug: "commands/list" },
            { label: "stats", slug: "commands/stats" },
            { label: "backup & restore", slug: "commands/backup-restore" },
          ],
        },
        {
          label: "Agents",
          items: [
            { label: "Overview", slug: "agents/overview" },
            { label: "Product Manager", slug: "agents/pm" },
            { label: "Creative Reviewer", slug: "agents/pm-reviewer" },
            { label: "Technical Architect", slug: "agents/spec-reviewer" },
            { label: "UI/UX Designer", slug: "agents/designer" },
            { label: "Design Reviewer", slug: "agents/design-reviewer" },
            { label: "Senior Engineer", slug: "agents/engineer" },
            { label: "Code Reviewer", slug: "agents/code-reviewer" },
            { label: "QA Engineer", slug: "agents/tester" },
            { label: "Cross-Model Reviewer", slug: "agents/cross-model-reviewer" },
            { label: "Fleet Strategist", slug: "agents/fleet-strategist" },
            { label: "Fleet Reviewer", slug: "agents/fleet-reviewer" },
          ],
        },
        {
          label: "Configuration",
          items: [
            { label: "Pipeline Config", slug: "configuration/pipeline" },
            { label: "Environment Variables", slug: "configuration/environment" },
            { label: "GitHub Action", slug: "configuration/github-action" },
          ],
        },
        {
          label: "Changelog",
          slug: "changelog",
        },
      ],
    }),
  ],
});
