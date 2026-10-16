import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidReleaseVersion } from "../../scripts/release-utils.mjs";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appDirectory, "..");

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not run git ${args[0]}: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Git could not ${args[0]}; check the repository and remote, then retry.`);
  }
  return result;
}

function gitOutput(...args) {
  return git(args).stdout.trim();
}

async function main() {
  const [version, ...extra] = process.argv.slice(2);
  // npm does not preserve build metadata as a distinct release identity.
  if (!version || extra.length > 0 || !isValidReleaseVersion(version) || version.includes("+")) {
    throw new Error(
      "Provide one valid npm semantic version without build metadata or a leading v, for example 1.2.3.",
    );
  }

  if (gitOutput("branch", "--show-current") !== "main") {
    throw new Error("Release preparation requires a clean checkout of main.");
  }
  if (gitOutput("status", "--porcelain", "--untracked-files=all")) {
    throw new Error("Release preparation requires a clean checkout of main.");
  }

  const remote = gitOutput("config", "--get", "branch.main.remote");
  const mergeRef = gitOutput("config", "--get", "branch.main.merge");
  if (!remote || remote === "." || mergeRef !== "refs/heads/main") {
    throw new Error("main must track a configured remote main branch before release preparation.");
  }
  git(["fetch", "--quiet", "--no-tags", remote, "main"]);
  if (gitOutput("rev-parse", "HEAD") !== gitOutput("rev-parse", "FETCH_HEAD")) {
    throw new Error(
      "Local main is not up to date with its configured remote; update it manually and retry.",
    );
  }

  const branch = `release/${version}`;
  if (
    git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true })
      .status === 0
  ) {
    throw new Error(`Branch ${branch} already exists locally.`);
  }
  if (gitOutput("ls-remote", "--heads", remote, `refs/heads/${branch}`)) {
    throw new Error(`Branch ${branch} already exists on the configured remote.`);
  }

  const packagePath = path.join(appDirectory, "package.json");
  const lockPath = path.join(appDirectory, "package-lock.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    manifest.name !== "tbspec" ||
    manifest.version !== lock.version ||
    manifest.version !== lock.packages?.[""]?.version
  ) {
    throw new Error(
      "The application package and lockfile metadata must match before release preparation.",
    );
  }
  if (version === manifest.version) {
    throw new Error(
      "The requested release version must differ from the current application version.",
    );
  }

  git(["switch", "--create", branch]);
  manifest.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  git(["add", "app/package.json", "app/package-lock.json"]);
  git(["commit", "-m", `chore(release): prepare ${version}`]);

  console.log(
    `Prepared ${branch} at ${gitOutput("rev-parse", "HEAD")}. Review the commit, then push it to start full verification.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
