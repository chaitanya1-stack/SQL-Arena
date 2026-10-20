
import { PGlite } from '@electric-sql/pglite';
import { createInterface } from 'node:readline';
import { queryPolicy } from '../../packages/core/query-policy.js';

type Request = {
  schema: string;
  setup: string;
  sql: string;
};

function send(value: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function normalize(value: unknown, typeId: number): unknown {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (typeId === 1082) {
      return value.toISOString().slice(0, 10);
    }
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }

  if (typeof value === 'bigint') return value.toString();

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }

  return value;
}

const db = new PGlite({
  parsers: {
    1082: (value) => value,
    1114: (value) => value,
    1184: (value) => value
  }
});

try {
  // Wait until the WebAssembly database can execute queries.
  console.error('[pglite-child] Starting WASM initialization');

  await db.query('SELECT 1');

  console.error('[pglite-child] WASM initialization completed');

  // The parent process waits for this exact signal.
  send({ type: 'ready' });
} catch {
  send({
    type: 'fatal',
    error: 'PGlite initialization failed.'
  });
  process.exit(1);
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

// Handle multiple datasets within one runner process.
for await (const line of input) {
  try {
    if (Buffer.byteLength(line, 'utf8') > 500_000) {
      send({
        type: 'result',
        verdict: 'Resource Limit Exceeded',
        error: 'Runner input is too large.'
      });
      continue;
    }

    const request = JSON.parse(line) as Request;

    if (
      typeof request.schema !== 'string' ||
      typeof request.setup !== 'string' ||
      typeof request.sql !== 'string'
    ) {
      send({
        type: 'result',
        verdict: 'Internal Judge Error',
        error: 'Invalid runner request.'
      });
      continue;
    }

    const policyError = queryPolicy(request.sql);

    if (policyError) {
      send({
        type: 'result',
        verdict: 'Unsupported Query',
        error: policyError
      });
      continue;
    }

    // Reset database state before each dataset.
    await db.exec(
      'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
    );

    await db.exec(request.schema);
    await db.exec(request.setup);

    const started = performance.now();

    const result = await db.query(request.sql, [], {
      rowMode: 'array'
    });

    const elapsedMs = Math.round(performance.now() - started);

    if (result.fields.length > 30 || result.rows.length > 1000) {
      send({
        type: 'result',
        verdict: 'Resource Limit Exceeded',
        error: 'Query result exceeds the allowed limits.'
      });
      continue;
    }

    const columns = result.fields.map(field => field.name);

    const rows = (result.rows as unknown[][]).map(row =>
      row.map((value, index) =>
        normalize(value, result.fields[index].dataTypeID)
      )
    );

    send({
      type: 'result',
      columns,
      rows,
      elapsedMs
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Query execution failed.';

    send({
      type: 'result',
      verdict: 'Runtime Error',
      error: message.slice(0, 500)
    });
  }
}

await db.close();
