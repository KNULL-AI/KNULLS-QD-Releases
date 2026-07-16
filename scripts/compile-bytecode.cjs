const fs = require("fs");
const path = require("path");
const bytenode = require("bytenode");

const root = path.resolve(__dirname, "..");
const targets = [
  {
    source: path.join(root, "electron", "main.js"),
    output: path.join(root, "electron", "main.jsc"),
  },
];

for (const { source, output } of targets) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source file: ${source}`);
  }
  bytenode.compileFile({
    filename: source,
    output,
    compileAsModule: true,
  });
  console.log(`Compiled ${path.relative(root, source)} -> ${path.relative(root, output)}`);
}
