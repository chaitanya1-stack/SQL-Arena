
import { PGlite } from '@electric-sql/pglite';
import { queryPolicy } from '../../packages/core/query-policy.js';

type RunnerInput = {
  schema: string;
  setup: string;
  sql: string;
};

type RunnerResult = {
  columns?: string[];
  rows?: unknown[][];
  elapsedMs?: number;
  error?: string;
  verdict?: string;
};

const MAX_INPUT_BYTES = 500_000;
const MAX_OUTPUT_ROWS = 1000;
const MAX_OUTPUT_COLUMNS = 30;

async function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let input = '';
    let bytes = 0;
    let finished = false;

    function fail(error: Error) {
      if (finished) return;
      finished = true;
      reject(error);
    }

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: string) => {
      if (finished) return;

      bytes += Buffer.byteLength(chunk, 'utf8');

      if (bytes > MAX_INPUT_BYTES) {
        fail(new Error('Runner input too large.'));
        process.stdin.pause();
        return;
      }

      input += chunk;
    });

    process.stdin.on('end', () => {
      if (finished) return;
      finished = true;
      resolve(input);
    });

    process.stdin.on('error', (error) => {
      fail(error);
    });

    process.stdin.resume();
  });
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

async function execute(
  input: RunnerInput
): Promise<RunnerResult> {
  const { schema, setup, sql } = input;

  if (
    typeof schema !== 'string' ||
    typeof setup !== 'string' ||
    typeof sql !== 'string'
  ) {
    return {
      verdict: 'Internal Judge Error',
      error: 'Invalid runner input.'
    };
  }

  const policyError = queryPolicy(sql);

  if (policyError) {
    return {
      verdict: 'Unsupported Query',
      error: policyError
    };
  }

  const db = new PGlite({
    parsers: {
      1082: (value) => value,
      1114: (value) => value,
      1184: (value) => value
    }
  });

  try {
    // These must come from trusted question-bank content.
    await db.exec(schema);
    await db.exec(setup);

    const started = Date.now();

    const result = await db.query(sql, [], {
      rowMode: 'array'
    });

    const elapsedMs = Date.now() - started;

    const columns = result.fields.map(
      (field) => field.name
    );

    if (
      columns.length > MAX_OUTPUT_COLUMNS ||
      result.rows.length > MAX_OUTPUT_ROWS
    ) {
      return {
        verdict: 'Resource Limit Exceeded',
        error: 'Query result exceeds the allowed limits.'
      };
    }

    const rows = (result.rows as unknown[][]).map(
      (row) => row.map(normalizeValue)
    );

    return {
      columns,
      rows,
      elapsedMs
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Query execution failed.';

    return {
      verdict: 'Runtime Error',
      error: message.slice(0, 500)
    };
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  let output: RunnerResult;

  try {
    const raw = await readStdin();

    const input = JSON.parse(raw) as RunnerInput;

    output = await execute(input);
  } catch {
    output = {
      verdict: 'Internal Judge Error',
      error: 'Unable to initialize PostgreSQL runner.'
    };
  }

  process.stdout.write(
    JSON.stringify(output) + '\n'
  );
}

await main();
