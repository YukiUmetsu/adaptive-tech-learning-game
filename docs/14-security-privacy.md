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
route. It is disabled outside local/test by default. When explicitly enabled
outside local/test it requires an `X-Internal-Token` shared secret, and a normal
authenticated learner token is never sufficient. It returns aggregate metrics
only and never per-user data.

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

Do not execute arbitrary learner code in V1.

If code-running quizzes are added later, use a dedicated sandbox service with strict CPU/memory/time/network limits.

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
