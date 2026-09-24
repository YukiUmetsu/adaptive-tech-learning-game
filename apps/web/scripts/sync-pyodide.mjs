#!/usr/bin/env node
/**
 * Downloads the pinned, self-hosted Pyodide runtime into
 * `public/python-runtime/pyodide/<version>/`.
 *
 * It fetches the interpreter plus the dependency closure of the approved
 * scientific packages (`PYTHON_PACKAGES` below, mirrored by the content
 * allowlist and `src/pythonExecution/packages.ts`). Every package wheel is
 * verified against the SHA-256 in the pinned Pyodide lock file.
 *
 * The version appears in the directory name, so assets are immutable and can be
 * served with a long-lived immutable cache. The app never loads Pyodide from an
 * unversioned CDN: it always reads this same-origin path.
 *
 * Usage:
 *   node scripts/sync-pyodide.mjs              # core + approved packages
 *   node scripts/sync-pyodide.mjs --core-only  # skip package wheels
 *   node scripts/sync-pyodide.mjs --force      # re-download everything
 *
 * The assets are build output, not source, and are git-ignored.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Must match PYODIDE_VERSION in src/pythonExecution/config.ts. */
const PYODIDE_VERSION = "314.0.7";

/** Interpreter files required for any Python execution. */
const CORE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

/** Must match PYTHON_ALLOWED_PACKAGES in the content validator. */
const PYTHON_PACKAGES = ["numpy", "pandas", "matplotlib"];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const targetDir = join(
  webRoot,
  "public",
  "python-runtime",
  "pyodide",
  PYODIDE_VERSION,
);
const baseUrl = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const force = process.argv.includes("--force");
const coreOnly = process.argv.includes("--core-only");

async function existsNonEmpty(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function fetchBuffer(file) {
  const url = `${baseUrl}${file}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function download(file, sha256) {
  const target = join(targetDir, file);
  if (!force && (await existsNonEmpty(target))) {
    process.stdout.write(`skip ${file} (already present)\n`);
  } else {
    process.stdout.write(`fetch ${file}\n`);
    const buffer = await fetchBuffer(file);
    await mkdir(targetDir, { recursive: true });
    await writeFile(target, buffer);
  }

  if (sha256) {
    const actual = createHash("sha256")
      .update(await readFile(join(targetDir, file)))
      .digest("hex");
    if (actual !== sha256) {
      throw new Error(`checksum mismatch for ${file}`);
    }
  }
}

/** Resolves the dependency closure of the approved packages from the lock. */
async function packageFiles() {
  const lock = JSON.parse(
    await readFile(join(targetDir, "pyodide-lock.json"), "utf8"),
  );
  const packages = lock.packages ?? {};
  const seen = new Map();

  const visit = (name) => {
    if (seen.has(name)) {
      return;
    }
    const entry = packages[name];
    if (!entry) {
      throw new Error(`approved package ${name} is not in the pinned lock file`);
    }
    seen.set(name, entry);
    for (const dependency of entry.depends ?? []) {
      visit(dependency);
    }
  };

  for (const name of PYTHON_PACKAGES) {
    visit(name);
  }
  return [...seen.values()];
}

async function main() {
  process.stdout.write(
    `Syncing Pyodide ${PYODIDE_VERSION} into public/python-runtime/pyodide/${PYODIDE_VERSION}/\n`,
  );
  for (const file of CORE_FILES) {
    await download(file);
  }
  if (coreOnly) {
    process.stdout.write("Skipping package wheels (--core-only).\n");
    process.stdout.write("Python runtime core ready.\n");
    return;
  }
  const files = await packageFiles();
  process.stdout.write(
    `Approved packages: ${PYTHON_PACKAGES.join(", ")} (${files.length} wheels with dependencies)\n`,
  );
  for (const entry of files) {
    await download(entry.file_name, entry.sha256);
  }
  process.stdout.write("Python runtime ready.\n");
}

main().catch((error) => {
  process.stderr.write(
    `Python runtime sync failed: ${error instanceof Error ? error.message : String(error)}\n` +
      "The app still builds; Python exercises show a recoverable load error until assets are synced.\n",
  );
  process.exitCode = 1;
});
