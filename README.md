# SQL Arena

A complete source repository for a SQL practice and timed assessment app, with a dark interface, real database judge implementation, user accounts, and an administrator workspace.

**Delivery status:** application source and deployment configuration are included. This repository has not been publicly deployed or certified production-ready. The full MySQL 8.4 / PostgreSQL 16 Docker test suite must pass on your host before opening registration. See [the verification report](docs/TESTING.md).

## Included

- Next.js, React, TypeScript, Monaco SQL editor served locally, Lucide icons and TanStack Query.
- Fastify REST API, PostgreSQL application database, Redis and BullMQ job workers.
- 200 original company-style problems: **40 easy, 110 medium, 50 hard**, with **800 datasets**, both SQL solutions, expected outputs, hints and explanations.
- Separate admin sign-in entry at **`/?admin=1`**, enforced administrator permissions, add/edit/archive, JSON import/export, version history, validation and publication.
- Registration, email/password login, guest sessions, configurable Google OAuth, configurable email verification and password reset, profiles and account deletion.
- Question search, database filters, bookmarks, progress, submission history and rule-based recommendations.
- Resizable editor/problem panels, Run and Submit, actual job status polling and real result comparisons.
- Randomized mocks with server deadlines, saved drafts, automatic finalization, locked solutions during timed mocks and final reports.
- Docker Compose, GitHub Actions, unit tests, offline API checks, Docker integration tests and load scripts.

The platform never executes learner SQL against its application database. The judge creates a disposable, networkless database container for each job, uses SELECT-only credentials and resets its schema between datasets. There is no SQLite execution fallback. The offline Python content generator uses SQLite only to prepare fixed fixtures; the runtime judge always targets MySQL/PostgreSQL.

## Start locally

Requirements: Node.js 22.12+ or 24, Docker Engine/Desktop with Compose, Bash, and Python 3 for the interactive administrator helper. On a small laptop, start with `JUDGE_CONCURRENCY=1`. No cloud account is needed for local use.

```bash
npm ci
bash scripts/bootstrap.sh
python3 scripts/create_admin.py --docker
```

Open **http://localhost:3000** and sign in with the administrator you created. There is no default admin password. Configuration is generated into an ignored `.env` with a random application database password.

The initial seed is deliberately **unpublished**. To run both engines on all questions and publish only after every required validation passes:

```bash
bash scripts/publish-bank.sh
```

This launches many real database instances and can take substantial time. Results are checkpointed; rerunning resumes unchanged successful questions. If a query or container fails, the command exits unsuccessfully and the bank is not published. Fix the reported issue and rerun. You can also validate and publish individual questions from the admin panel.

Stop services without deleting data:

```bash
docker compose down
```

Do not add `-v` unless you intend to delete saved application data and queue data.

## Development

After `node scripts/configure.mjs`, start PostgreSQL and Redis, run migrations and seed drafts:

```bash
docker compose up -d db redis
npm run migrate
npm run seed
npm run dev
```

In a second terminal run `npm run worker` after building the two sandbox images with `scripts/bootstrap.sh` or the commands in [deployment](docs/DEPLOYMENT.md). The worker needs access to a Docker daemon. `npm run dev` serves the frontend on port 3000 and API on port 4000. Monaco assets are copied locally before development/build; no editor CDN is required.

Useful commands:

```bash
npm test
npm run typecheck
npm run check:content
npm run check:postgres:offline
npm run build
npm run test:integration
npm run validate:bank
npm run seed -- --publish
```

`test:integration` requires disposable PostgreSQL, Redis and the sandbox images. It is not safe to run against a production application database. Offline checks do not satisfy the publication gate.

## Add a question

1. Sign in at `/?admin=1`.
2. Select **Add question** and use a new stable `qNNN` identifier and unique slug.
3. Edit title, difficulty, statement, tags and explanation.
4. Open **Full question JSON** to edit schemas, both reference queries, sample tables, expected outputs, hints and datasets.
5. Include exactly one visible sample and at least two hidden datasets, each with an independently fixed expected output.
6. Save a draft. Click **Validate**. Inspect the detailed validation report by opening the question.
7. Click **Publish** only after validation succeeds on both engines.

Every edit creates a new immutable version. Mocks and submissions reference their original version. Archiving/unpublishing removes a question from future selection while retaining history. Imports accept a JSON array, `{ "questions": [...] }`, or one question in the UI; large imports are batched in groups of 25. A failed later import batch does not undo earlier successful batches.

## Deployment and configuration

- [Deployment, domain, TLS, backups and scaling](docs/DEPLOYMENT.md)
- [Architecture, security boundaries and trade-offs](docs/ARCHITECTURE.md)
- [API routes](docs/API.md)
- [Verification report and remaining gates](docs/TESTING.md)
- [Question catalogue](docs/QUESTION_CATALOG.md)

Google OAuth and email features appear only when configured. Use `PUBLIC_ORIGIN/api/auth/google/callback` as the Google redirect URI. Set `SMTP_URL` and `MAIL_FROM` for mail. Never commit `.env` or cloud credentials.

The frontend can run on Vercel, but **the judge requires Docker-capable compute**. Sites/Workers hosting alone cannot run this system’s database containers. The repository is the deployable deliverable; no hosted URL is implied.

## Scope and practical limits

This implementation uses Fastify and SQL migrations with `pg` instead of NestJS/Prisma, and a small CSS component system instead of Tailwind/shadcn. This reduces setup and generated code while retaining a structured TypeScript application. Submission updates use bounded polling rather than WebSockets/SSE. Authentication is part of the stateless API with database-backed sessions, not a separate auth microservice.

Read-only SELECT/CTE exercises are supported. Duplicate-removal exercises return the rows to remove; arbitrary DDL/DML is not allowed. Row limits are 1,000 and serialized result limits are 1 MB. Query runtime limit defaults to 3 seconds; startup and the complete job have separate limits. No claimed concurrent-user capacity is supported by load measurements yet.

The dashboard currently includes solved counts, difficulty mix, accuracy, UTC streaks, activity heatmap, topic proficiency, recommendations and history. Fine-grained active-time measurement, weekly/score trend visualizations, server-side saved practice drafts across devices, and automatic autoscaling remain future work. Practice drafts are saved on the current browser; mock drafts and graded progress are stored on the server. Guest data is cleaned after 30 days.

Company names are transparent **company-style simulations**. None of these questions is represented as a verified proprietary interview question. Topic labels such as query optimization do not mean the judge evaluates query plans; it evaluates output correctness and resource limits.
