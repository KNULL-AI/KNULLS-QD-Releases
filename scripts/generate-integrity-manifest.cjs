const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "electron", "integrity-manifest.json");

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function listDistFiles() {
  const distRoot = path.join(root, "dist");
  const out = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (/\.(js|css|html)$/i.test(entry.name)) {
        out.push(path.relative(root, abs).replace(/\\/g, "/"));
      }
    }
  }

  if (fs.existsSync(distRoot)) {
    walk(distRoot);
  }
  return out.sort();
}

const staticTargets = [
  "electron/main.js",
  "electron/main.jsc",
  "electron/preload.js",
  "electron/session-preload.js",
  "electron/main.entry.js",
];

const targets = [...new Set([...staticTargets, ...listDistFiles()])];
const files = {};

for (const rel of targets) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Integrity target missing: ${rel}`);
  }
  files[rel] = hashFile(abs);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  algorithm: "sha256",
  files,
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Generated ${path.relative(root, manifestPath)} with ${targets.length} entries`);
