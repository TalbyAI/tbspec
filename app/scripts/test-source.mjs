import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = resolve(appDirectory, "tests");

function integerArgument(value, label) {
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe integer range.`);
  return parsed;
}

function run() {
  const args = process.argv.slice(2);
  const listOnly = args.at(-1) === "--list-only";
  const positional = listOnly ? args.slice(0, -1) : args;
  if (positional.length !== 2) {
    throw new Error(
      "Usage: node scripts/test-source.mjs <partition-index> <partition-count> [--list-only]",
    );
  }

  const [indexValue, countValue] = positional;
  const partitionIndex = integerArgument(indexValue, "Partition index");
  const partitionCount = integerArgument(countValue, "Partition count");
  if (partitionCount < 1) throw new Error("Partition count must be greater than zero.");
  if (partitionIndex >= partitionCount)
    throw new Error("Partition index must be less than partition count.");

  const testFiles = readdirSync(testsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();
  if (testFiles.length === 0) throw new Error("No top-level tests/*.test.ts files were found.");

  const selectedFiles = testFiles.filter(
    (_, fileIndex) => fileIndex % partitionCount === partitionIndex,
  );
  if (selectedFiles.length === 0)
    throw new Error(`Partition ${partitionIndex} contains no test files.`);

  console.log(
    `Source test partition ${partitionIndex + 1}/${partitionCount}: ${selectedFiles.length}/${testFiles.length} files`,
  );
  for (const file of selectedFiles) console.log(`tests/${file}`);
  if (listOnly) return;

  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      "--test-reporter=tap",
      ...selectedFiles.map((file) => `tests/${file}`),
    ],
    { cwd: appDirectory, stdio: "inherit" },
  );
  if (result.error) {
    console.error(`Unable to start the source test runner: ${result.error.message}`);
    process.exitCode = 1;
  } else if (result.signal) {
    console.error(`The source test runner stopped on signal ${result.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
