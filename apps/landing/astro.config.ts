import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://copilot-swarm.dev",
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
