#!/usr/bin/env node
/**
 * Cross-platform itch.io zip (same output as package-itch.sh).
 * Runs build:itch, then zips `out/` → dist/creep-labyrinth-itch.zip.
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
process.chdir(root);

execSync("npm run build:itch", { stdio: "inherit" });

const outDir = path.join(root, "out");
if (!fs.existsSync(outDir)) {
  console.error("package-itch: out/ missing after build");
  process.exit(1);
}

const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, "creep-labyrinth-itch.zip");
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

if (process.platform === "win32") {
  const outLit = outDir.replace(/'/g, "''");
  const zipLit = zipPath.replace(/'/g, "''");
  const ps = `Get-ChildItem -LiteralPath '${outLit}' | Compress-Archive -DestinationPath '${zipLit}' -Force`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  execSync(`cd "${outDir}" && zip -q -r "${zipPath}" . -x "*.DS_Store"`, { stdio: "inherit", shell: true });
}

const stat = fs.statSync(zipPath);
const mb = (stat.size / (1024 * 1024)).toFixed(1);
console.log(`Created ${zipPath} (${mb} MB) — itch.io: New Project → Uploads → HTML → this zip.`);
