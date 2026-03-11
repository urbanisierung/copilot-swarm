import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// vscode-jsonrpc@8.2.1 lacks an "exports" field, causing ESM resolution
// failures when @github/copilot-sdk imports "vscode-jsonrpc/node" (without .js).
// This postinstall script adds the missing exports map.

const require = createRequire(import.meta.url);
let pkgPath;
try {
	pkgPath = require.resolve("vscode-jsonrpc/package.json");
} catch {
	process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.exports) process.exit(0);

pkg.exports = {
	".": "./lib/node/main.js",
	"./node": "./node.js",
	"./node.js": "./node.js",
	"./browser": "./browser.js",
	"./browser.js": "./browser.js",
};
writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
