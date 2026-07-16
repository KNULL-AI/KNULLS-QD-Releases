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

async function main() {
  for (const { source, output } of targets) {
    if (!fs.existsSync(source)) {
      throw new Error(`Missing source file: ${source}`);
    }

    await bytenode.compileFile({
      filename: source,
      output,
      compileAsModule: true,
      // Electron >= 42 requires compiling inside an actual Electron main process
      // to avoid cachedData mismatch when loading .jsc in the packaged main process.
      electronMain: true,
    });

    console.log(`Compiled ${path.relative(root, source)} -> ${path.relative(root, output)} (electronMain)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
