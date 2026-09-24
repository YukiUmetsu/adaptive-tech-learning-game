# Security and Privacy

## Security model

Local-first improves cost and latency but the browser is untrusted.

### Server-authoritative

- mission definition/content version
- answer scoring used for economic rewards
- wallet ledger
- inventory ownership
- gacha
- paid entitlements
- accepted learning-event references

### Client-local only

- animations
- drag state
- offline puzzle flow
- cached predictions
- pending, uncommitted rewards

## Authoritative mission protocol

The server issues a versioned mission containing:

```text
mission_instance_id
user_id
question/content version
reward_policy_version
knowledge_snapshot_version
issued_at / expires_at
nonce
```

The client returns answer primitives. The server re-scores against canonical content and computes the reward from the frozen pre-mission state.

Never trust:

```text
client final score
client final reward
client wallet balance
client claimed difficulty
```

## Reward exploit invariant

For the same frozen question state:

```text
first-attempt success
>= failure + recovery
> reveal/skip
```

Challenge/reward multiplier is frozen before the first attempt.

## Offline behavior

- offline learning allowed
- offline economic rewards are pending
- event IDs prevent duplicate acceptance
- high-value spending/gacha requires online server transaction
- no last-write-wins wallet merge

## Multi-device conflict model

| State | Rule |
|---|---|
| learning events | append + event-ID dedup |
| learner snapshot | server-derived/cache |
| wallet | append-only ledger |
| inventory | server transaction |
| campaign | validated monotonic merge |
| preferences | versioned optimistic concurrency |

## Wallet/economy

Every economic mutation requires:

- authenticated user
- mission/action identifier
- idempotency key
- server validation
- append-only ledger entry
- atomic transaction

## Gacha

Persist:

```text
roll_id
user_id
banner_version
odds_version
pity_before
pity_after
result
currency_debit
idempotency_key
timestamp
```

V1 uses earned-only gacha. Any paid randomized items require separate legal/app-store review.

## API

- strict body limits
- schema validation
- rate limiting
- timeouts
- CORS allowlist
- CSP
- CSRF protection where cookie flows require it
- no secrets/tokens in logs
- abuse detection for impossible completion speed/volume

### Internal endpoints

`/internal/model-evaluation` is an operator/developer surface, not a learner
route. It is disabled outside local/test by default, and when disabled the route
is not mounted at all, so it returns 404 to every caller rather than revealing
its existence through a 401. When explicitly enabled outside local/test it
requires an `X-Internal-Token` shared secret, and a normal authenticated learner
token is never sufficient. It returns aggregate metrics only and never per-user
data.

## Database

- TLS
- least-privilege role
- parameterized SQL
- small scoped connection pools
- migration backups
- independent logical backups before paid economy
- periodic restore test
- provider PITR/SLA tier when required

## R2

- private buckets by default
- scoped credentials
- short-lived presigned upload URLs
- separate prod/staging keys
- validate checksum/object metadata before acceptance

An uploaded object is untrusted telemetry until referenced by a server-accepted sync/mission record.

## Privacy

Collect only what is required for:

- learner state
- product operation
- ML improvement
- fraud/abuse prevention

Training uses internal IDs, not email.

Exclude auth tokens, raw email, and unnecessary profile data.

## Account deletion

Immediate:

1. disable/delete live account state as required
2. add deletion tombstone
3. exclude user from all future dataset builds immediately

Background:

1. identify R2 raw/Parquet partitions containing the user
2. rewrite without that user's rows
3. delete superseded objects
4. record completion

Document policy for already-trained shared models; do not promise automatic model unlearning unless implemented.

## Content/code execution

Learner code is never executed by the API. Python exercises run in the browser
on Pyodide (CPython compiled to WebAssembly), behind an isolated sandbox, and
the API receives only a `{ passed, total }` test count as an answer primitive.
This does not make WebAssembly a learning-engine dependency: WASM is confined to
the disposable client sandbox.

### Sandbox architecture

```text
React app
  -> PythonExecutionClient
  -> hidden iframe (app origin by default, or a dedicated origin if configured)
  -> disposable Web Worker
  -> Pyodide with jsglobals = {}   (no JavaScript bridge)
  -> learner Python
```

- The app shell never executes learner Python on its own thread.
- **Learner Python gets no JavaScript bridge.** Pyodide's `js` module is built
  from `jsglobals`, and the worker loads it with `jsglobals: {}`. Python
  therefore has no handle to `fetch`, `indexedDB`, `caches`, `location`,
  `postMessage`, `importScripts`, `globalThis`, `Function`, or `document`; the
  attempts raise `AttributeError`. This is what prevents access to site storage,
  files, and the network without needing a separate domain.
- The Web Worker platform supplies a second layer: workers have no `document`,
  `localStorage`, or `sessionStorage`, so window-only secrets are unreachable
  even before the bridge restriction.
- Pyodide's virtual filesystem is per-worker in-memory state, not the site's
  served files, and the CSP `connect-src 'self'` blocks exfiltration.
- A dedicated origin remains available as stronger, browser-enforced isolation:
  set `VITE_PYTHON_SANDBOX_ORIGIN` to a distinct origin that serves the same
  `dist`. That origin must contain no auth cookies, tokens, API keys,
  application storage, or private user data, and the app origin must be allowed
  in its `frame-ancestors` CSP. It is optional; the default is the app origin.
- The configured origin is parsed strictly: only a bare absolute `http(s)`
  origin is accepted. Values with credentials, a path, a query, a fragment, or
  a non-HTTP scheme are ignored, so a bad build variable cannot point the iframe
  at an unexpected document.
- The sandbox document refuses to relay anything unless it is framed
  (`window.parent !== window`) and opened with a valid `appOrigin`.
- The iframe is created with an empty `allow` (all permission-policy features
  denied) and `referrerPolicy="no-referrer"`.
- Messaging is strictly validated in both directions. The app accepts a message
  only when `event.origin` is the sandbox origin and `event.source` is its own
  iframe; the sandbox only accepts messages from the `appOrigin` it was opened
  with. Every payload is shape-validated, and no executable JavaScript is ever
  sent across the boundary.
- CSP for the sandbox document is isolated to `apps/web/public/_headers`
  (`/python-sandbox/*`): `default-src 'none'`, same-origin scripts and workers,
  `'wasm-unsafe-eval'` for WebAssembly, and `connect-src 'self'` so learner code
  cannot make arbitrary network requests. Pyodide-specific directives are never
  added to a global app CSP.
- Assets are self-hosted and versioned
  (`/python-runtime/pyodide/<pinned-version>/`) and served immutable. The pinned
  version is in the URL, so a version change is a new URL.

### Trust model and limits

Client-side execution means test results are client-attested. The server
validates that the reported total matches the authored test count and derives
partial credit, but it cannot re-run the learner program. As with other
local-first scoring, `/v1/sync` settles the primitive the client submits, so
this interaction must not be treated as higher-assurance evidence.

Defensive limits: execution timeout, maximum source length (checked on the
client and again in the worker), maximum captured stdout/stderr with truncation,
maximum tests per execution, maximum serialized result size, and a fresh learner
namespace per execution. `builtins`, `sys.path`, and `os.environ` are snapshotted
before each run and restored afterwards, so learner code cannot leave global
state behind. On timeout the entire runner is terminated and recreated.

The Python/WASM heap is bounded by a memory quota (default 384 MiB,
`VITE_PYTHON_MAX_MEMORY_MB`, hard ceiling 1 GiB). Before the runtime loads, every
`WebAssembly.Memory.grow` is wrapped so growth past the quota fails; CPython
surfaces that as a catchable `MemoryError` and the interpreter stays usable. A
runner-level failure discards and recreates the runtime. This bounds the WASM
linear memory (the Python heap), not the whole process: JS-side allocations and
engine bookkeeping are outside it, so it is a real quota rather than a promise
of a full memory sandbox.

### Packages

Content may declare runtime packages from an explicit allowlist
(`PYTHON_ALLOWED_PACKAGES`). The allowlist is enforced in three places: content
validation, the client (untrusted input is filtered before sending), and the
worker (before loading). Learner code can never request a package.

- Approved today: `numpy`, `pandas`, `matplotlib` — the scientific packages
  shipped by the pinned Pyodide build.
- `seaborn` is intentionally **not** approved: the pinned Pyodide build does not
  ship it. Enabling it would require `micropip` and a PyPI fetch, which would
  widen the sandbox's network policy and reintroduce arbitrary package
  installation. Add it only via a Pyodide release that ships it, or a separately
  reviewed vendored wheel.
- Packages load from the pinned, self-hosted distribution with Pyodide's
  package loader (`loadPackage`) — never `micropip`, `loadPackagesFromImports`,
  PyPI, or arbitrary URLs. `connect-src 'self'` keeps those fetches same-origin.
- `scripts/sync-pyodide.mjs` downloads the dependency closure of the approved
  packages and verifies every wheel against the SHA-256 in the pinned
  `pyodide-lock.json`.
- `micropip` imports are blocked as defense in depth.

### JavaScript bridge

Pyodide builds its `js` module from `jsglobals`, and the worker passes `{}`, so
learner Python's `js` namespace exposes **nothing**. Verified against the pinned
build: `js.fetch`, `js.indexedDB`, `js.caches`, `js.globalThis`,
`js.postMessage`, `js.importScripts`, `js.Function`, and `js.document` all raise
`AttributeError`, while `numpy`/`pandas`/`matplotlib` still load and compute.
`scripts/verify-python-runtime.mjs` asserts this, so a `PYODIDE_VERSION` change
that widens the bridge fails the release check rather than silently weakening
the sandbox.

Corollaries:

- With no bridge, learner Python has no path to origin storage, the
  service-worker caches, same-origin requests, or arbitrary network access.
- CSP `connect-src 'self'` still governs the runtime's own asset fetches and
  blocks external requests.
- This is the reason a separate origin is not required. A dedicated origin is
  still supported (and stronger, because the browser enforces it) but is not the
  default.
- The restriction is defense in depth on top of the worker platform; keep
  `verify:python` in the release checklist when bumping `PYODIDE_VERSION`.

If the runtime cannot start (unsupported browser, missing assets, sandbox load
failure), the exercise shows a clear message and a **Continue without running**
action. The rest of the lesson and every non-Python question are unaffected, and
the learner is never blocked on that question. Continuing is recorded as a
zero-pass attempt — the lowest reward tier — so it cannot be used to gain
progress.

Test definitions ship to the browser because execution is client-side, so they
are inspectable. Do not put secrets in tests; truly secret tests would require
server-side execution and are outside this feature.

Learner source is never sent to the API and never logged to analytics. Execution
telemetry records only the outcome kind, duration, and test counts.

## Supply chain

CI:

```text
cargo fmt/clippy/test
cargo audit
cargo deny (optional)
JS lockfile/audit review
container vulnerability scan
secret scan
```

Use immutable image digests for production promotion.

## Security limitation

If canonical answer keys are delivered to the client for offline use, a determined user can inspect them. The design aims to prevent easy reward fabrication, not provide high-assurance exam proctoring.

Ordinary study missions intentionally deliver canonical scoring metadata so they
can be scored locally with zero per-question requests. This is an accepted
trade-off: the client score is optimistic only, and `/v1/sync` always re-scores
the raw answer against server-known content before recording evidence, settling
Bits, or updating concept state. Practice tests never expose answer keys before
submission.
