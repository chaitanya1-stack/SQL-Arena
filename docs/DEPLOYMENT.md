# Deployment guide

## Local release check

Run on a disposable Docker-capable machine:

```bash
npm ci
node scripts/configure.mjs
docker build --target postgres -f Dockerfile.sandbox -t sql-arena-postgres .
docker build --target mysql -f Dockerfile.sandbox -t sql-arena-mysql .
docker compose up -d db redis
npm run migrate
npm test
npm run typecheck
npm run test:integration
npm run validate:bank
npm run build
```

Start services using `bash scripts/bootstrap.sh`, create the administrator, then validate/publish the bank with `bash scripts/publish-bank.sh`. Inspect container startup and query-limit failures rather than weakening sandbox flags to make a test pass. The configuration is written for Linux Docker and must be verified on the chosen host and architecture.

## Public deployment

Use a frontend/app host plus a **separate judge host or judge node pool**. PostgreSQL and Redis should be private managed services or protected private infrastructure. They must not accept public Internet connections. Do not expose the Docker API.

1. Put this repository in a private GitHub repository. Run the included CI and fix both jobs before release.
2. Configure an application PostgreSQL database. Run migrations using a deployment identity, then use a limited runtime identity for application operations in production.
3. Configure private Redis with authentication/TLS where supported by the chosen provider. Set `REDIS_URL` accordingly.
4. Deploy the API image on container-capable hosting. Set `DATABASE_URL`, `REDIS_URL`, `APP_ORIGIN`, `PUBLIC_ORIGIN`, `NODE_ENV=production` and `COOKIE_SECURE=true`.
5. Deploy the frontend. `API_INTERNAL_URL` is embedded into the Next.js proxy rewrite at build time; rebuild for the correct API destination. Keep frontend and browser-facing API under the same HTTPS origin. The UI does not need a public database URL.
6. Build and pin the two sandbox images on the dedicated judge host. Start workers with the application database/Redis endpoints and appropriate Docker daemon access. The worker itself can reach application services; the child SQL containers have no network.
7. Create an administrator with `scripts/create_admin.py` using stdin. Do not put a bootstrap password in GitHub or a shell command line.
8. Run `validate:bank` on the judge infrastructure, then `seed -- --publish` against the application database. Copy the exact validation report to the seeding environment; do not forge or substitute it.
9. Configure the optional email/Google integrations, then verify registration, account recovery, sessions, logout and deletion on the real domain.
10. Run the real-engine integration tests against a disposable staging database and load tests against staging before admitting public traffic.

No live cloud resources, domain, repository push or paid hosting purchase has been made for this deliverable.

## Domain and HTTPS

Point the domain’s DNS to your ingress/load balancer and obtain a managed TLS certificate. If serving the web container behind Caddy on a small app host, an example Caddyfile is:

```caddyfile
sql.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Replace the example hostname. Keep `APP_ORIGIN=https://sql.example.com` and `PUBLIC_ORIGIN=https://sql.example.com` identical to the actual browser origin, with no trailing slash. Set `COOKIE_SECURE=true`. Do not enable `TRUST_PROXY=true` while exposing the API directly to arbitrary clients; restrict it to the trusted ingress path and configure trusted proxy ranges for a larger deployment.

For Google OAuth, register the exact callback `https://sql.example.com/api/auth/google/callback`. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your secret manager. For email, use `SMTP_URL` and `MAIL_FROM` belonging to a verified sender domain.

## Capacity planning — assumptions, not benchmarks

Browsing users and simultaneous judging jobs are different workloads. Measure submissions per minute, time spent initializing sandboxes, queue wait time, query time, memory peaks and end-to-end latency before sizing production.

| Planning scenario | Starting experiment, not guaranteed capacity |
|---|---|
| 100 concurrent browsers | One 2-vCPU/2–4-GB app instance; managed PostgreSQL/Redis; a separate 4-vCPU/4–8-GB judge host with 1–2 workers executing concurrently |
| 1,000 concurrent browsers | At least two stateless API replicas, connection pooling, separate web delivery, a measured judge pool scaled from queue age |
| 10,000 concurrent browsers | CDN/web distribution, horizontally scaled API and judge pools, managed HA storage/Redis, metadata caching, admission control and load-tested database queries |

Each active sandbox is capped at 0.5 CPU and 512 MiB memory, plus worker/daemon overhead. For example, 100 simultaneous sandbox executions imply at least 50 CPU-equivalents of configured quota and up to 50 GiB of sandbox memory limits, before overhead. These are resource caps, not measured requirements or a performance guarantee. A queue can support many more browsing users than simultaneous running jobs.

Compare provider quotes only after selecting region, machine sizes, traffic and managed-service tiers. No current monthly price is asserted here. Budget for app compute, judge compute, managed database, Redis, backups, logs, egress, domain and email separately. Start with concurrency 1–2 and increase only after benchmarks.

```bash
LOAD_BASE_URL=https://staging.example.com LOAD_USERS=20 LOAD_SECONDS=30 npm run load
BENCH_CONCURRENCY=2 BENCH_ROUNDS=5 npm run benchmark:judge
```

The first measures browsing only. The second launches real SQL sandboxes and reports end-to-end judge time. Neither has been run as a production load benchmark in this environment.

## Monitoring and recovery

- `/api/health` checks the application database and Redis. The admin workspace shows worker connections, queue counts, recent infrastructure failures and audit activity.
- Ship API/worker logs to your logging service. Redact cookies, credentials, submitted queries and hidden datasets. Alert on old queued jobs, repeated startup failures, sustained worker saturation, unavailable database/Redis and disk pressure.
- Keep rolling encrypted PostgreSQL backups and provider point-in-time recovery if available. Test restoration into an isolated staging instance. Back up `.env`/secrets separately in a secret manager.
- Redis AOF is enabled locally. PostgreSQL outbox rows reconstruct pending work after a queue interruption. Completed failed infrastructure jobs are visible and can be retried by resubmitting.
- Before upgrading engine images, rerun both integration tests and the complete bank validator with `--force`. Pin the verified digests in production.
- Schema changes should be backed up, reviewed and applied through ordered migrations. The initial migration is idempotent, but it is not a general down-migration system.
- In a release rollback, redeploy the previous application image while preserving database volumes and question versions. Do not erase PostgreSQL to roll back a frontend change.

## Browser checks

On your staging machine with the app running and validated questions published, install the Playwright browser and run the supplied desktop/mobile tests:

```bash
npx playwright install chromium
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

These checks exercise guest sign-in, question filtering, admin denial, mock reload/deadline persistence and real Monaco query execution. They were not run in the delivery environment.
