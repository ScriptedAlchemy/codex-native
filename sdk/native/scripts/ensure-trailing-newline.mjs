import fs from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error("Usage: node scripts/ensure-trailing-newline.mjs <file...>");
}

for (const file of files) {
  const contents = fs.readFileSync(file, "utf8");
  if (contents.length === 0) {
    continue;
  }
  if (!contents.endsWith("\n")) {
    fs.writeFileSync(file, `${contents}\n`, "utf8");
  }
}
