# Architecture and security

## Request flow

1. Next.js serves the UI and proxies same-origin `/api` requests to Fastify.
2. Fastify resolves a random opaque session cookie against a SHA-256 token fingerprint in the application PostgreSQL database. Passwords use salted scrypt. State-changing requests require the configured exact Origin; cookies are HttpOnly, SameSite=Lax and Secure in production.
3. Questions use stable IDs with immutable JSONB versions. Public responses strip solutions, explanations and hidden datasets. Versions are pinned when an assessment or submission is created.
4. A submission is written to PostgreSQL as a durable outbox entry. The worker dispatcher queues the ID in BullMQ; a Redis interruption cannot erase an accepted database record.
5. The worker claims the queued row with an atomic state update. It loads the private question version and creates one ephemeral PostgreSQL or MySQL container for that job.
6. The container has `--network none`, a read-only filesystem, small tmpfs volumes, 512 MiB memory and swap limit, 0.5 CPU limit, PID limit, dropped capabilities, no-new-privileges, and a non-root database OS user. It never receives application database credentials.
7. Trusted setup uses the generated sandbox administrator password; the learner query runs as a separate SELECT-only database role in a read-only transaction. The schema is reset before each dataset. Reference outputs are kept in the application content, never inserted into the learner database.
8. The driver returns positional rows and column metadata. The judge compares typed values with explicit NULL semantics, duplicate-preserving matching and optional numeric tolerance. Ordering is checked only when required. Only visible-sample rows and errors are returned to the learner; hidden query errors are redacted.
9. The container is force-removed in `finally`. Startup recovery removes labeled orphan sandboxes older than ten minutes; interrupted submissions are marked infrastructure errors rather than wrong answers.

## Important boundaries

The lexical query filter is only an early policy check. SELECT permissions, read-only transactions, isolated disposable database instances, no network and hard host-enforced limits form the execution boundary. A driver-level single statement prevents a statement string from escaping the intended query protocol. PostgreSQL uses an extended-protocol cursor; the MySQL learner connection disables multiple statements.

The worker needs Docker control. Access to the Docker socket is powerful. **The supplied Compose setup is a local-development layout. Use a dedicated, restricted judge host for public production**, rather than giving a worker the production app host’s Docker daemon. Run updated engine images, pin verified image digests for releases, and maintain the host’s security updates. This code has not received an external security audit.

Database catalogs inside a sandbox may expose that sandbox’s own schema metadata; there are no other users’ datasets or platform tables there. Database superuser credential tables and file access are unavailable to the learner role. System functions can still be expensive, so both a database query timeout and a hard process/container deadline are necessary.

## Assessment consistency

The API generates the deadline from the database clock. The browser displays remaining time relative to a returned server timestamp and `performance.now()` and periodically resynchronizes. Changing the browser wall clock does not change the stored deadline.

Draft updates and finishing lock the same mock record. Finishing freezes the last saved query for each question into a final submission, then marks the mock ended. A uniqueness constraint ensures one final answer per position. Expiry is enforced by both worker sweeps and reads of an expired mock; refreshing cannot grant more time. If workers stop, an expired assessment stays expired and finalizes when a worker/read resumes.

Mock selection uses a SHA-256 seeded ordering and balances difficulty/topic coverage greedily over the eligible bank. The same seed and eligible candidate set yield the same selection; changing filters or the bank can change it. Solved and recent-attempt exclusions are enforced in the database. If too few eligible questions remain, the request asks the user to relax filters rather than silently ignoring them.

## Data and access

- Learner submissions, bookmarks, mocks and dashboard records are scoped to session user ID. Supplying another user ID in a request cannot override the session.
- Admin role checks are performed server-side, including content export and monitoring. Registration cannot set a role.
- Edits append versions; publishing requires successful validation for the exact canonical content hash. Old assessment results are not recalculated on edits.
- Account deletion cascades private user data. Audit records retain the action but set the deleted user reference to NULL.
- Google sign-in uses OAuth state and PKCE. Existing password accounts are not silently linked by matching email.
- Email reset/verification tokens are random, fingerprinted, expiring and single-use; password resets revoke sessions.

## Performance and trade-offs

Disposable containers provide a clear isolation boundary, but startup dominates small query latency. Do not promise sub-second executions. The worker concurrency is bounded and new API submissions are limited to three queued/running submissions per user plus a Redis-backed request rate limit. API servers can scale horizontally; each adds a 10-connection application pool. Plan total connections and use a pooler when appropriate.

Metadata filtering and pagination happen in PostgreSQL. The schema includes indexes for tags, per-user history and question verdict lookups. Redis currently handles rate limits and queues; public-question caching is a future optimization. Add caches keyed by published version, not mutable question ID alone.

A trusted validation job reuses its own isolated instance across datasets, recreating the schema between datasets. No instance is reused across users/jobs. Admin-authored setup is trusted content, not learner input; expected outputs are reviewed content and are not inferred from the learner’s answer.

## Primary references

- PostgreSQL client settings and timeouts: https://www.postgresql.org/docs/16/runtime-config-client.html
- MySQL read-only transactions: https://dev.mysql.com/doc/refman/8.4/en/commit.html
- MySQL system variables: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html
- Official PostgreSQL image definition: https://github.com/docker-library/postgres/blob/master/16/bookworm/Dockerfile
