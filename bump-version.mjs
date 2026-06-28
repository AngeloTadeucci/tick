// Bump the app version in every place it's duplicated.
// Usage: pnpm bump <new-version>   e.g. pnpm bump 0.1.2
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("Usage: pnpm bump <x.y.z>   e.g. pnpm bump 0.1.2");
  process.exit(1);
}

// current version is the source of truth — read it once, replace it everywhere
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const cur = pkg.version;
if (cur === next) {
  console.log(`Already at ${next}, nothing to do.`);
  process.exit(0);
}

// each target: the file and the exact substring to swap (anchored so we only
// touch the app's own version, never a dependency's)
const edits = [
  ["package.json", `"version": "${cur}"`, `"version": "${next}"`],
  ["src-tauri/tauri.conf.json", `"version": "${cur}"`, `"version": "${next}"`],
  ["src-tauri/Cargo.toml", `version = "${cur}"`, `version = "${next}"`],
  ["src-tauri/Cargo.lock", `name = "tick"\nversion = "${cur}"`, `name = "tick"\nversion = "${next}"`],
];

for (const [file, from, to] of edits) {
  const txt = readFileSync(file, "utf8");
  if (!txt.includes(from)) {
    console.error(`! ${file}: couldn't find \`${from.split("\n")[0]}\` — skipped`);
    process.exit(1);
  }
  writeFileSync(file, txt.replace(from, to)); // first match only — the app's own
  console.log(`  ${file}`);
}

console.log(`\nBumped ${cur} -> ${next}. Review, then commit and \`pnpm build\`.`);
