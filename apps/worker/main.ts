
import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { db } from '../api/db.js';
import { finishMock } from '../api/mocks.js';
import { judge, validateQuestion } from './judge.js';
import { questionSchema } from '../../packages/core/question.js';
import { contentHash } from '../../packages/core/content-hash.js';
import { warmPglite, stopWarmPglite } from './sandbox.js';

export async function startWorker() {
  console.info('[worker] Starting SQL Arena PostgreSQL worker');

  if (process.env.PGLITE_PILOT === 'true') {
    console.info('[pglite] Starting background prewarm');

    void warmPglite()
      .then(() => {
        console.info('[pglite] Initial runner is ready');
      })
      .catch((error) => {
        console.error(
          '[pglite] Initial runner failed:',
          error instanceof Error ? error.message : String(error)
        );
      });
  }

  const connection = new Redis(
    process.env.REDIS_URL || 'redis://localhost:6379',
    { maxRetriesPerRequest: null }
  );

  const queue = new Queue('sql-arena', { connection });

  const worker = new Worker(
    'sql-arena',
    async (job) => {
      if (job.name === 'validate') {
        const { rows } = await db.query(
          `UPDATE question_versions
           SET validation_status = 'running',
               validation_started_at = now()
           WHERE id = $1 AND validation_status = 'queued'
           RETURNING *`,
          [job.data.id]
        );

        const version = rows[0];
        if (!version) return;

        try {
          const question = questionSchema.parse(version.body);

          if (contentHash(question) !== version.content_hash) {
            throw new Error('Content hash mismatch');
          }

          console.info(`[worker] Validating question version ${version.id}`);

          const report = await validateQuestion(question);

          await db.query(
            `UPDATE question_versions
             SET validation_status = $1,
                 validation_report = $2
             WHERE id = $3`,
            [
              report.postgresCompatible ? 'passed' : 'failed',
              JSON.stringify(report),
              version.id
            ]
          );

          console.info(
            `[worker] Validation finished: ${report.postgresCompatible ? 'passed' : 'failed'}`
          );
        } catch (error) {
          console.error(
            '[worker] Validation failed:',
            error instanceof Error ? error.message : String(error)
          );

          await db.query(
            `UPDATE question_versions
             SET validation_status = 'failed',
                 validation_report = $1
             WHERE id = $2`,
            [
              JSON.stringify({
                error: 'Validation infrastructure failed. Retry validation.'
              }),
              version.id
            ]
          );
        }

        return;
      }

      if (job.name !== 'submission') return;

      const { rows } = await db.query(
        `UPDATE submissions
         SET state = 'running',
             started_at = now()
         WHERE id = $1 AND state = 'queued'
         RETURNING *`,
        [job.data.id]
      );

      const submission = rows[0];
      if (!submission) return;

      const owner = await db.query(
        'SELECT role FROM users WHERE id = $1',
        [submission.user_id]
      );

      if (
        owner.rows[0]?.role !== 'admin' ||
        submission.dialect !== 'postgres'
      ) {
        await db.query(
          `UPDATE submissions
           SET state = 'done',
               verdict = 'Unsupported Query',
               result = $1,
               finished_at = now()
           WHERE id = $2`,
          [
            JSON.stringify({
              error: 'Execution unavailable: administrator-only PostgreSQL pilot.'
            }),
            submission.id
          ]
        );
        return;
      }

      try {
        const version = await db.query(
          'SELECT body FROM question_versions WHERE id = $1',
          [submission.version_id]
        );

        if (!version.rows[0]) {
          throw new Error('Question version not found');
        }

        const question = questionSchema.parse(version.rows[0].body);

        const started = Date.now();

        console.info(
          `[worker] Executing submission ${submission.id}`
        );

        const result = await judge(
          question,
          submission.dialect,
          submission.query,
          submission.mode === 'run'
        );

        const elapsed = Date.now() - started;

        console.info(
          `[worker] Submission finished verdict=${result.verdict} elapsed_ms=${elapsed}`
        );

        if (
          result.verdict === 'Internal Judge Error' &&
          job.attemptsMade < 1
        ) {
          await db.query(
            `UPDATE submissions
             SET state = 'queued'
             WHERE id = $1`,
            [submission.id]
          );
          throw new Error('Retry infrastructure failure');
        }

        await db.query(
          `UPDATE submissions
           SET state = 'done',
               verdict = $1,
               result = $2,
               finished_at = now()
           WHERE id = $3`,
          [
            result.verdict,
            JSON.stringify(result),
            submission.id
          ]
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Retry infrastructure failure'
        ) {
          throw error;
        }

        console.error(
          '[worker] Submission failed:',
          error instanceof Error ? error.message : String(error)
        );

        await db.query(
          `UPDATE submissions
           SET state = 'done',
               verdict = 'Internal Judge Error',
               result = $1,
               finished_at = now()
           WHERE id = $2`,
          [
            JSON.stringify({
              error: 'The judge could not complete this request. Please retry.'
            }),
            submission.id
          ]
        );
      }
    },
    {
      connection,
      concurrency: 1,
      lockDuration: 180000
    }
  );

  worker.on('error', (error) => {
    console.error('[worker] Queue error:', error.message);
  });

  let dispatching = false;
  let lastCleanup = 0;
  let lastRecovery = 0;

  async function dispatch() {
    if (dispatching) return;

    dispatching = true;

    try {
      if (Date.now() - lastCleanup < 1000) {
        // Normal dispatch continues below.
      }

      if (Date.now() - lastRecovery >= 30000) {
        lastRecovery = Date.now();

      const expired = await db.query(
        `SELECT id FROM mocks
         WHERE ended_at IS NULL AND deadline <= now()
         LIMIT 50`
      );

      for (const mock of expired.rows) {
        await finishMock(mock.id);
      }

      await db.query(
        `UPDATE submissions
         SET state = 'done',
             verdict = 'Internal Judge Error',
             result = '{"error":"The worker stopped before completing this request. Please retry."}',
             finished_at = now()
         WHERE state = 'running'
           AND started_at < now() - interval '5 minutes'`
      );

      const pending = await db.query(
        `SELECT s.id
         FROM submissions s
         JOIN users u ON u.id = s.user_id
         WHERE s.state = 'queued'
           AND u.role = 'admin'
         ORDER BY s.created_at
         LIMIT 100`
      );

      for (const submission of pending.rows) {
        await queue.add(
          'submission',
          { id: submission.id },
          {
            jobId: submission.id,
            attempts: 2,
            backoff: {
              type: 'exponential',
              delay: 1000
            },
            removeOnComplete: {
              age: 86400,
              count: 10000
            },
            removeOnFail: {
              age: 86400
            }
          }
        );
      }

      const validations = await db.query(
        `SELECT id FROM question_versions
         WHERE validation_status = 'queued'
         LIMIT 10`
      );

      for (const version of validations.rows) {
        await queue.add(
          'validate',
          { id: version.id },
          {
            jobId: 'validate-' + version.id,
            removeOnComplete: true,
            removeOnFail: true
          }
        );
      }

      }

      if (Date.now() - lastCleanup >= 60000) {
        lastCleanup = Date.now();

      await db.query(
        'DELETE FROM sessions WHERE expires_at < now()'
      );

      await db.query(
        'DELETE FROM auth_tokens WHERE expires_at < now()'
      );

      await db.query(
        `DELETE FROM users
         WHERE role = 'guest'
           AND created_at < now() - interval '30 days'`
      );

      await db.query(
        `UPDATE question_versions
         SET validation_status = 'failed',
             validation_report = '{"error":"Validation worker stopped; retry validation."}'
         WHERE validation_status = 'running'
           AND validation_started_at < now() - interval '5 minutes'`
      );
      }
    } catch (error) {
      console.error(
        '[worker] Dispatch failed:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      dispatching = false;
    }
  }

  const timer = setInterval(() => {
    void dispatch();
  }, 30000);

  await dispatch();

  console.info('[worker] Queue consumer initialized');

  return async function stopWorker() {
    console.info('[worker] Shutting down');

    clearInterval(timer);

    await worker.close();
    await stopWarmPglite();
    await queue.close();
    await connection.quit();

    console.info('[worker] Shutdown complete');
  };
}
