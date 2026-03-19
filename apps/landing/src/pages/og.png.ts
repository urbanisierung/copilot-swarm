import type { APIRoute } from "astro";
import sharp from "sharp";

function buildSvg(): string {
  const cmd = "npx @copilot-swarm/core &quot;Add OAuth login&quot;";
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa" />
      <stop offset="50%" stop-color="#60a5fa" />
      <stop offset="100%" stop-color="#34d399" />
    </linearGradient>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0a0f" />
      <stop offset="100%" stop-color="#12121f" />
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="0" y="0" width="1200" height="4" fill="url(#grad)" />
  <circle cx="950" cy="180" r="320" fill="#a78bfa" opacity="0.06" />
  <circle cx="250" cy="500" r="200" fill="#60a5fa" opacity="0.04" />

  <!-- Logo text -->
  <text x="80" y="140" font-family="sans-serif" font-size="72" font-weight="800" fill="#ff00ff" letter-spacing="8">SWARM</text>

  <!-- Tagline -->
  <text x="80" y="220" font-family="sans-serif" font-size="36" font-weight="700" fill="url(#grad)">One prompt. An entire engineering team.</text>

  <text x="80" y="290" font-family="sans-serif" font-size="22" fill="#8888a0">Multi-agent orchestrator that coordinates PM, designer,</text>
  <text x="80" y="322" font-family="sans-serif" font-size="22" fill="#8888a0">engineer, reviewer, and tester agents. Powered by GitHub Copilot SDK.</text>

  <!-- Terminal snippet -->
  <rect x="60" y="380" width="1080" height="90" rx="12" fill="#111118" stroke="#2a2a3a" stroke-width="1.5" />
  <circle cx="90" cy="405" r="6" fill="#ff5f57" />
  <circle cx="110" cy="405" r="6" fill="#febc2e" />
  <circle cx="130" cy="405" r="6" fill="#28c840" />
  <text x="90" y="448" font-family="monospace" font-size="22" fill="#34d399">$</text>
  <text x="115" y="448" font-family="monospace" font-size="22" fill="#e2e8f0">${cmd}</text>

  <rect x="0" y="626" width="1200" height="4" fill="url(#grad)" />
</svg>`;
}

export const GET: APIRoute = async () => {
  const svg = buildSvg();
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  });
};
