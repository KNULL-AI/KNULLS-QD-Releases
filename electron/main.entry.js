const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const sourceMainPath = path.join(__dirname, "main.js");
const bytecodeMainPath = path.join(__dirname, "main.jsc");

if (!app.isPackaged) {
  require(sourceMainPath);
} else if (fs.existsSync(bytecodeMainPath)) {
  require("bytenode");
  require(bytecodeMainPath);
} else {
  throw new Error("Missing compiled main.jsc in packaged app build.");
}
