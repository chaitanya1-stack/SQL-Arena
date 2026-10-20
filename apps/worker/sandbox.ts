
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  Dialect,
  Question,
  Verdict
} from '../../packages/core/question.js';
import { queryPolicy } from '../../packages/core/query-policy.js';

export class JudgeError extends Error {
  constructor(
    public verdict: Verdict,
    message: string
  ) {
    super(message);
    this.name = 'JudgeError';
  }
}

export type Actual = {
  columns: string[];
  rows: unknown[][];
  elapsedMs: number;
};

type RunnerResponse = {
  columns?: string[];
  rows?: unknown[][];
  elapsedMs?: number;
  verdict?: Verdict;
  error?: string;
};

const RUNNER_PATH = fileURLToPath(
  new URL('./pglite-runner.ts', import.meta.url)
);

const TIMEOUT_MS = 8000;
const MAX_OUTPUT_BYTES = 1_200_000;

function runProcess(input: object): Promise<RunnerResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', RUNNER_PATH],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH || '',
          NODE_ENV: 'production'
        }
      }
    );

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    function finish(
      error?: Error,
      result?: RunnerResponse
    ) {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(result || {});
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');

      finish(
        new JudgeError(
          'Time Limit Exceeded',
          'PostgreSQL execution exceeded the time limit.'
        )
      );
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;

      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');

        finish(
          new JudgeError(
            'Resource Limit Exceeded',
            'Query output exceeded the allowed size.'
          )
        );
        return;
      }

      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', () => {
      finish(
        new JudgeError(
          'Internal Judge Error',
          'Could not start the PostgreSQL runner.'
        )
      );
    });

    child.on('close', (code) => {
      if (settled || timedOut) return;

      if (code !== 0) {
        finish(
          new JudgeError(
            'Internal Judge Error',
            'PostgreSQL runner exited unexpectedly.'
          )
        );
        return;
      }

      try {
        const result = JSON.parse(
          stdout.trim()
        ) as RunnerResponse;

        finish(undefined, result);
      } catch {
        finish(
          new JudgeError(
            'Internal Judge Error',
            'PostgreSQL runner returned invalid output.'
          )
        );
      }
    });

    child.stdin.on('error', () => {});

    child.stdin.end(JSON.stringify(input));
  });
}

export class Sandbox {
  private question: Question | null = null;
  private testIndex = 0;

  constructor(public dialect: Dialect) {}

  async start(): Promise<void> {
    if (this.dialect !== 'postgres') {
      throw new JudgeError(
        'Unsupported Query',
        'Only PostgreSQL is currently supported.'
      );
    }
  }

  async setup(
    question: Question,
    index: number
  ): Promise<void> {
    if (!question.tests[index]) {
      throw new JudgeError(
        'Internal Judge Error',
        'Test dataset not found.'
      );
    }

    this.question = question;
    this.testIndex = index;
  }

  async query(sql: string): Promise<Actual> {
    if (!this.question) {
      throw new JudgeError(
        'Internal Judge Error',
        'PostgreSQL sandbox is not initialized.'
      );
    }

    const policyError = queryPolicy(sql);

    if (policyError) {
      throw new JudgeError(
        'Unsupported Query',
        policyError
      );
    }

    const test = this.question.tests[this.testIndex];

    const response = await runProcess({
      schema: this.question.schema.postgres,
      setup: test.setup.postgres,
      sql
    });

    if (response.error || response.verdict) {
      throw new JudgeError(
        response.verdict || 'Runtime Error',
        response.error || 'Query execution failed.'
      );
    }

    if (
      !Array.isArray(response.columns) ||
      !Array.isArray(response.rows)
    ) {
      throw new JudgeError(
        'Internal Judge Error',
        'PostgreSQL runner returned incomplete results.'
      );
    }

    return {
      columns: response.columns,
      rows: response.rows,
      elapsedMs: response.elapsedMs || 0
    };
  }

  async close(): Promise<void> {
    this.question = null;
  }
}

// Temporary compatibility export for the old Docker cleanup
// module. We will remove that dependency in the next step.
export async function command(
  _args: string[]
): Promise<string> {
  throw new Error(
    'Docker commands are unavailable in PGlite mode.'
  );
}
