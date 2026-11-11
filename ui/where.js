// An error says "sothis-ui.js:LINE"? This tells you which file in this folder that line is in.   node ui/where.js 4321
const fs = require("fs"), path = require("path");
const n = +process.argv[2]; if (!n) { console.log("usage: node ui/where.js LINE"); process.exit(1); }
let at = 3;   // the joined script starts with a blank line and the opening line before the first file
for (const f of JSON.parse(fs.readFileSync(path.join(__dirname, "parts.json"), "utf8")).js) {
  const lines = fs.readFileSync(path.join(__dirname, f), "utf8").split("\n").length - 1;
  if (n < at + lines) { console.log("ui/" + f + " line " + (n - at + 1)); process.exit(0); }
  at += lines;
}
console.log("past the end of the script");
