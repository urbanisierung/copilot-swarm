import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cpswarm.com",
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
