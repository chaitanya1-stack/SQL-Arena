# SQL Arena PGlite pilot patch

This is an **administrator-only development pilot**, not a production public SQL sandbox.

## Merge

Copy the three application files and one test file into the matching paths of your **already edited** local SQL Arena repository. Do **not** overwrite your existing `pglite-runner.ts`, `sandbox.ts`, `judge.ts`, or `cleanup.ts`; this patch expects the versions you have been developing in this conversation.

## Run tests before deployment

```sh
npm ci --include=dev
npx tsc --noEmit
node --import tsx --test tests/pglite-functional.test.ts
npm run check:postgres:offline
```

**Do not confuse 800/800 reference-solution compatibility with hostile-query isolation testing.** The PGlite child process has no verified filesystem or network isolation and no hard OS memory quota. Do not offer untrusted public SQL execution on the Render free API instance.

## Optional admin-only cloud pilot

- Deploy this patch to Render only **after** tests pass, with `PGLITE_PILOT=true`; submissions are accepted exclusively from authenticated administrator accounts. All regular users receive HTTP 503 rather than an endlessly queued job.
- For regular public usage, keep `PGLITE_PILOT` unset/false until a properly isolated runner exists. This does not enable the public judge.
- Remove the `mysql` option from the web UI in a later step; API rejects it in pilot mode.
- Render's free tier may sleep, and runtime memory/cold starts remain uncertain.

## Important caveats

- The patch reuses the original BullMQ worker and adds it to the API process. It is intentionally `concurrency: 1`.
- `judge.ts` must be your PostgreSQL-only version with `validateQuestion()` returning `postgresCompatible` and `report`. The worker uses `postgresCompatible` to set validation status; the publish route confirms that exact one-engine provenance.
- No secure containment of malicious SQL has been implemented. **Do not enable the pilot for untrusted users.**
- An earlier deployment may have accumulated `queued` submissions. In pilot mode, the worker will process those old queued submissions too. Before enabling the pilot against production Neon/Redis, clear or mark old queued submissions as failed through a controlled admin maintenance procedure; do not run the old queue blindly.
- Never point PGlite query execution to your Neon application database.
- Changes do not guarantee compatibility with an existing production schema's JSONB report shape; confirm an admin validate/publish end-to-end test on a throwaway question before relying on it.
