
import { Sandbox, JudgeError } from './sandbox.js';
import { compare } from '../../packages/core/compare.js';
import { queryPolicy } from '../../packages/core/query-policy.js';

import type {
  Question,
  Dialect,
  Verdict
} from '../../packages/core/question.js';

export async function judge(
  q: Question,
  dialect: Dialect,
  sql: string,
  sampleOnly = false
) {
  const tests = q.tests
    .map((test, index) => ({ test, index }))
    .filter(({ test }) => !sampleOnly || !test.hidden);

  if (dialect !== 'postgres') {
    return {
      verdict: 'Unsupported Query' as Verdict,
      passed: 0,
      total: tests.length,
      error: 'Only PostgreSQL is currently supported.'
    };
  }

  const policyError = queryPolicy(sql);

  if (policyError) {
    return {
      verdict: 'Unsupported Query' as Verdict,
      passed: 0,
      total: tests.length,
      error: policyError
    };
  }

  const sandbox = new Sandbox('postgres');

  let passed = 0;
  let actual;
  let currentHidden = false;

  const started = Date.now();

  try {
    await sandbox.start();

    for (const { test, index } of tests) {
      currentHidden = test.hidden;

      await sandbox.setup(q, index);

      const result = await sandbox.query(sql);

      if (!test.hidden) {
        actual = result;
      }

      const correct = compare(
        test.expected,
        result,
        q.ordered,
        q.tolerance
      );

      if (!correct) {
        return {
          verdict: 'Wrong Answer' as Verdict,
          passed,
          total: tests.length,
          actual,
          elapsedMs: Date.now() - started
        };
      }

      passed++;
    }

    return {
      verdict: 'Accepted' as Verdict,
      passed,
      total: tests.length,
      actual,
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    const known = error instanceof JudgeError;

    const verdict: Verdict = known
      ? error.verdict
      : 'Internal Judge Error';

    const message = known
      ? error.message
      : 'The judge could not complete this request.';

    return {
      verdict,
      passed,
      total: tests.length,
      actual,
      error:
        currentHidden && verdict !== 'Internal Judge Error'
          ? 'The query failed on a hidden dataset.'
          : message,
      elapsedMs: Date.now() - started
    };
  } finally {
    await sandbox.close();
  }
}

/**
 * PostgreSQL-only question validation.
 *
 * Runs the official solution against every dataset,
 * including hidden datasets.
 *
 * This replaces the old two-database validation logic
 * for development purposes.
 */
export async function validateQuestion(q: Question) {
  const postgresResult = await judge(
    q,
    'postgres',
    q.solutions.postgres,
    false
  );

  const compatible = postgresResult.verdict === 'Accepted';

  return {
    // Preserve the original two-engine publishing gate
    // until the admin API is explicitly updated.
    passed: false,
    postgresCompatible: compatible,
    engines: ['postgres'],
    checkedAt: new Date().toISOString(),
    report: {
      postgres: postgresResult,
      mysql: {
        status: 'Not tested',
        reason: 'MySQL execution is not currently supported.'
      }
    }
  };
}
