#!/usr/bin/env node
/**
 * Verifies the pinned Pyodide runtime and the trusted Python harness.
 *
 * This is a maintainer/release check, not part of `pnpm test`: it needs the
 * synced WASM assets and a working network fetch the first time. Run
 * `pnpm sync:python` first.
 *
 *   node scripts/verify-python-runtime.mjs
 *
 * It executes the exact harness string the browser sandbox uses and asserts
 * observable behavior for passing, failing, stdout, exception, syntax, and
 * runtime-error cases.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Must match PYODIDE_VERSION in src/pythonExecution/config.ts. */
const PYODIDE_VERSION = "314.0.7";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(scriptDir, "..");
const runtimeDir = join(
  webRoot,
  "public",
  "python-runtime",
  "pyodide",
  PYODIDE_VERSION,
);

const harnessSource = readFileSync(
  join(webRoot, "src", "pythonSandbox", "harness.ts"),
  "utf8",
);
const harness = harnessSource.split("String.raw`")[1]?.split("`;")[0];
if (!harness) {
  throw new Error("could not extract the Python harness");
}

const shimSource = readFileSync(
  join(webRoot, "src", "pythonSandbox", "airflowShim.ts"),
  "utf8",
);
const airflowShim = shimSource.split("String.raw`")[1]?.split("`;")[0];
if (!airflowShim) {
  throw new Error("could not extract the Airflow study shim");
}

const module = await import(
  pathToFileURL(join(runtimeDir, "pyodide.mjs")).href
);
// Mirror the worker: give Python no JavaScript bridge at all.
const pyodide = await module.loadPyodide({
  indexURL: `${runtimeDir}/`,
  jsglobals: {},
});

async function run(payload) {
  pyodide.globals.set("__verify_payload__", JSON.stringify(payload));
  const raw = await pyodide.runPythonAsync(
    `${harness}\n${airflowShim}\n_run(__verify_payload__)`,
  );
  return JSON.parse(String(raw));
}

const bridgeSurface = JSON.parse(
  await pyodide.runPythonAsync(`
import json, js
json.dumps({name: hasattr(js, name) for name in [
    "fetch", "indexedDB", "caches", "localStorage", "location",
    "postMessage", "importScripts", "globalThis", "document", "Function",
]})
`),
);

const failures = [];

// The JS bridge must expose nothing, or learner code could reach site storage,
// files, and the network. This mirrors the worker's `jsglobals: {}`.
check(
  "JS bridge exposes no browser capabilities",
  Object.values(bridgeSurface).every((value) => value === false),
  JSON.stringify(bridgeSurface),
);
function check(name, condition, detail) {
  if (condition) {
    process.stdout.write(`ok   ${name}\n`);
  } else {
    failures.push(`${name}: ${detail}`);
    process.stdout.write(`FAIL ${name}: ${detail}\n`);
  }
}

const limits = { maxStdoutBytes: 16000 };

const passing = await run({
  ...limits,
  source: "def square(x):\n    return x * x\n",
  entrypoint: "square",
  tests: [
    { type: "call", args: [2], expected: 4 },
    { type: "call", args: [-3], expected: 9 },
    { type: "call", args: [0], expected: 0 },
  ],
});
check("passing program", passing.status === "passed", passing.status);

const failing = await run({
  ...limits,
  source: "def add(a, b):\n    return a - b\n",
  entrypoint: "add",
  tests: [
    { type: "call", args: [1, 2], expected: 3 },
    { type: "call", args: [2, 2], expected: 4 },
  ],
});
check(
  "failing program reports each test",
  failing.status === "failed" && failing.tests.length === 2,
  JSON.stringify(failing.tests),
);

const stdout = await run({
  ...limits,
  source: "for n in range(1, 4):\n    print(n)\n",
  entrypoint: "",
  tests: [{ type: "stdout", expected: "1\n2\n3" }],
});
check("stdout capture", stdout.status === "passed", JSON.stringify(stdout));

const raises = await run({
  ...limits,
  source: "def pair(a, b):\n    return list(zip(a, b, strict=True))\n",
  entrypoint: "pair",
  tests: [
    { type: "raises", args: [[1], [1, 2]], exception: "ValueError" },
  ],
});
check("expected exception", raises.status === "passed", JSON.stringify(raises));

const syntax = await run({
  ...limits,
  source: "if age >= 18\n    print('x')\n",
  entrypoint: "",
  tests: [{ type: "stdout", expected: "x" }],
});
check(
  "syntax error is structured",
  syntax.status === "syntax_error" &&
    syntax.error?.line === 1 &&
    syntax.error?.type === "SyntaxError",
  JSON.stringify(syntax.error),
);

const runtimeError = await run({
  ...limits,
  source: "total = 1\nprint(totl)\n",
  entrypoint: "",
  tests: [{ type: "stdout", expected: "" }],
});
check(
  "runtime error suggests a close name",
  runtimeError.status === "runtime_error" &&
    runtimeError.error?.suggestion === "total",
  JSON.stringify(runtimeError.error),
);

const blocked = await run({
  ...limits,
  source: "import micropip\n",
  entrypoint: "",
  tests: [{ type: "stdout", expected: "" }],
});
check(
  "micropip is blocked",
  blocked.status === "runtime_error" &&
    blocked.error?.type === "ImportError",
  JSON.stringify(blocked.error),
);

// Approved scientific packages load from the pinned, self-hosted wheels.
pyodide.runPython("import os; os.environ['MPLBACKEND'] = 'Agg'");

await pyodide.loadPackage(["numpy"]);
const numpyMean = await pyodide.runPythonAsync(
  "import numpy as np\nfloat(np.mean(np.array([1.0, 2.0, 3.0])))",
);
check("numpy loads and computes", Number(numpyMean) === 2.0, String(numpyMean));

await pyodide.loadPackage(["pandas"]);
const pandasSum = await pyodide.runPythonAsync(
  "import pandas as pd\nint(pd.Series([1, 2, 3]).sum())",
);
check("pandas loads and computes", Number(pandasSum) === 6, String(pandasSum));

await pyodide.loadPackage(["matplotlib"]);
const backend = await pyodide.runPythonAsync(
  "import matplotlib\nmatplotlib.get_backend()",
);
check(
  "matplotlib loads on a headless backend",
  String(backend).toLowerCase() === "agg",
  String(backend),
);

// The built-in Airflow study shim imports and builds a DAG with no package
// load, network access, or PyPI. It is a sandbox built-in, not a wheel.
const airflowDag = await run({
  ...limits,
  source: `
import airflow
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator
from airflow.operators.python import PythonOperator
from airflow.utils.task_group import TaskGroup


def build():
    with DAG("etl", schedule="@daily") as dag:
        start = EmptyOperator(task_id="start")
        extract = BashOperator(task_id="extract", bash_command="echo extract")
        with TaskGroup(group_id="transform"):

            def clean():
                return "clean"

            transform = PythonOperator(
                task_id="transform", python_callable=clean
            )
        end = EmptyOperator(task_id="end")
        start >> [extract, transform] >> end
    return dag.topological_sort()
`,
  entrypoint: "build",
  tests: [
    {
      type: "call",
      args: [],
      expected: ["start", "extract", "transform", "end"],
    },
  ],
});
check(
  "airflow shim builds and orders a DAG",
  airflowDag.status === "passed",
  JSON.stringify(airflowDag),
);

const airflowDecorators = await run({
  ...limits,
  source: `
from airflow.decorators import dag, task


@dag(schedule="@daily")
def pipeline():

    @task
    def begin():
        return "begin"

    @task
    def finish():
        return "finish"

    begin() >> finish()


def task_ids():
    return pipeline().task_ids
`,
  entrypoint: "task_ids",
  tests: [{ type: "call", args: [], expected: ["begin", "finish"] }],
});
check(
  "airflow @dag/@task decorators build a DAG",
  airflowDecorators.status === "passed",
  JSON.stringify(airflowDecorators),
);

const airflowMarker = await run({
  ...limits,
  source:
    "import airflow\n\ndef info():\n    return [airflow.__study_shim__, airflow.__version__]\n",
  entrypoint: "info",
  tests: [{ type: "call", args: [], expected: [true, "study-shim-1"] }],
});
check(
  "airflow shim is marked and versioned",
  airflowMarker.status === "passed",
  JSON.stringify(airflowMarker),
);

// Each run re-creates the shim's context stacks, so a program that leaves a
// DAG context open cannot leak it into the next program in the same runtime.
await run({
  ...limits,
  source: "from airflow import DAG\nDAG('leaky').__enter__()\n",
  entrypoint: "",
  tests: [{ type: "stdout", expected: "" }],
});
const afterLeak = await run({
  ...limits,
  source:
    "from airflow.operators.empty import EmptyOperator\n\ndef orphan():\n    return EmptyOperator(task_id='solo').dag is None\n",
  entrypoint: "orphan",
  tests: [{ type: "call", args: [], expected: true }],
});
check(
  "a leaked DAG context does not affect the next run",
  afterLeak.status === "passed",
  JSON.stringify(afterLeak),
);

// The harness must compare NumPy scalars without breaking JSON serialization.
const numpyHarness = await run({
  ...limits,
  source:
    "import numpy as np\n\ndef mean(values):\n    return np.mean(np.array(values))\n",
  entrypoint: "mean",
  tests: [{ type: "call", args: [[1, 2, 3]], expected: 2.0 }],
});
check(
  "harness handles numpy scalar results",
  numpyHarness.status === "passed",
  JSON.stringify(numpyHarness),
);

// Memory quota: mirrors installMemoryQuota in src/pythonExecution/memoryQuota.ts.
// Installed last because it tightens every memory growth for the process.
{
  const heapBytes = pyodide._module?.HEAPU8?.length ?? 0;
  const budget = (heapBytes > 0 ? heapBytes : 256 * 1024 * 1024) + 16 * 1024 * 1024;
  const originalGrow = WebAssembly.Memory.prototype.grow;
  WebAssembly.Memory.prototype.grow = function (delta) {
    const next = this.buffer.byteLength + delta * 65536;
    if (next > budget) {
      throw new RangeError("python memory quota exceeded");
    }
    return originalGrow.call(this, delta);
  };

  let blocked = false;
  try {
    await pyodide.runPythonAsync("big = bytearray(400 * 1024 * 1024)\nlen(big)");
  } catch {
    blocked = true;
  }
  const after = await pyodide.runPythonAsync("3 + 4");
  check(
    "memory quota rejects oversized allocations and keeps running",
    blocked && Number(after) === 7,
    `blocked=${blocked} responsive=${after}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} runtime check(s) failed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nPython runtime verified.\n");
}
