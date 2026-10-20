# Verification report

Delivery checks performed on 20 October 2026. This report distinguishes checks that ran from supplied checks that still require a suitable host.

| Check | Result and scope |
| --- | --- |
| Automated tests | **25 passed, 0 failed.** Password/session helpers, result comparison, SQL input policy, reproducible mock selection, content fingerprints, private-data filtering and question contracts. Offline API checks also cover authorization, publication gates, private submissions, mock expiry and dashboard counts. |
| TypeScript | Strict checks passed for the API, worker, shared code, scripts and frontend. |
| Frontend production build | Next.js production compilation, type checking and static page generation passed. This does not verify a running browser or deployed services. |
| Content structure | **200 distinct questions; 40 easy, 110 medium, 50 hard; 800 datasets.** Required samples/hidden datasets, identifiers, reference queries and output shapes passed checks. |
| Supplemental PostgreSQL execution | **800 of 800 fixtures passed** with PGlite 0.5.10 / PostgreSQL 18.6 WASM. Details: [offline-postgres-check.json](offline-postgres-check.json). This is not PostgreSQL 16 Docker or MySQL verification. |
| Production dependency audit | `npm audit --omit=dev` reported **0 known vulnerabilities** on the check date. This is a dependency check, not a security audit of the application or sandbox. |
| Script syntax | The sandbox runner's Node syntax and the bootstrap/publication shell syntax passed checks. |

## Offline API test limitations

The offline API tests use Fastify injection and an actual PGlite SQL database with a small adapter for the application's PostgreSQL pool interface. They do not start an HTTP listener, Redis or Docker. They verify request handling and SQL state transitions but do not establish distributed-worker behavior, PostgreSQL concurrency behavior or deployment readiness.

The content generator prepares fixed fixtures using SQLite and independent spot checks. The supplemental PGlite run checks every PostgreSQL reference query against those fixed outputs. Neither path is used to execute learner submissions at runtime or to satisfy the publication gate.

## Release checks still required

The following were supplied but **not executed in the delivery environment**, where Docker, the database server binaries and a supported browser automation surface were unavailable:

- Real PostgreSQL 16 / Redis platform integration tests and concurrency behavior.
- Real PostgreSQL 16 and MySQL 8.4 sandbox integration tests, container startup, privilege boundaries, network isolation, query timeout and resource limits.
- Every question on both production SQL engines through `npm run validate:bank`.
- Desktop/mobile Playwright tests and visual inspection of the running interface.
- Live email delivery, Google OAuth, domain/TLS configuration and cloud deployment.
- Browser and SQL-judge load benchmarks, backup restoration and an independent security review before public untrusted use.

No live URL has been deployed, and no concurrent-user capacity is claimed. Sandbox flags and supplied tests are implementation work, not proof of an audited security boundary.

## Publication and operation

The seed command imports drafts. A version must pass the real-engine validator on both SQL engines, with a matching content fingerprint, before it can be published. The offline results are deliberately in a separate report and cannot unlock publication. Administrators can validate and publish individual questions from the admin panel, or run `bash scripts/publish-bank.sh` for the bank.

See [DEPLOYMENT.md](DEPLOYMENT.md) for host-level checks and [the README](../README.md#scope-and-practical-limits) for implementation trade-offs and features outside the delivered scope.
