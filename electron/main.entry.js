const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const sourceMainPath = path.join(__dirname, "main.js");
const bytecodeMainPath = path.join(__dirname, "main.jsc");
const integrityManifestPath = path.join(__dirname, "integrity-manifest.json");

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function verifyPackagedIntegrity() {
  if (!fs.existsSync(integrityManifestPath)) {
    throw new Error("Missing integrity manifest in packaged app.");
  }

  const manifest = JSON.parse(fs.readFileSync(integrityManifestPath, "utf8"));
  const files = manifest?.files || {};

  for (const [relPath, expectedHash] of Object.entries(files)) {
    const normalized = relPath.replace(/\//g, path.sep);
    const absPath = path.join(path.resolve(__dirname, ".."), normalized);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Integrity check failed: missing ${relPath}`);
    }
    const actualHash = hashFile(absPath);
    if (actualHash !== expectedHash) {
      throw new Error(`Integrity check failed: hash mismatch for ${relPath}`);
    }
  }
}

if (!app.isPackaged) {
  require(sourceMainPath);
} else if (fs.existsSync(bytecodeMainPath)) {
  verifyPackagedIntegrity();
  try {
    require("bytenode");
    require(bytecodeMainPath);
  } catch (err) {
    if (fs.existsSync(sourceMainPath)) {
      // Fallback path for V8/bytecode compatibility drift.
      console.warn("[knull] Failed to load main.jsc; falling back to main.js:", err?.message || err);
      require(sourceMainPath);
    } else {
      throw err;
    }
  }
} else {
  if (fs.existsSync(sourceMainPath)) {
    require(sourceMainPath);
  } else {
    throw new Error("Missing compiled main.jsc and fallback main.js in packaged app build.");
  }
}
