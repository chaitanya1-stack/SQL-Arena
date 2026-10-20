import { createServer } from 'node:http';
import { startWorker } from './main.js';

setInterval(() => {
  const m = process.memoryUsage();
  console.log('[memory]', JSON.stringify({
    rssMB: Math.round(m.rss / 1024 / 1024),
    heapMB: Math.round(m.heapUsed / 1024 / 1024),
    externalMB: Math.round(m.external / 1024 / 1024)
  }));
}, 5000);

if (process.env.PGLITE_PILOT !== 'true') {
  throw new Error('PGLITE_PILOT must be true');
}

let ready = false;
let shuttingDown = false;
let stopWorker: (() => Promise<void>) | undefined;

const server = createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  res.writeHead(ready ? 200 : 503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify({
    ok: ready,
    service: 'sql-arena-judge'
  }));
});

server.listen(
  Number(process.env.PORT || 10000),
  '0.0.0.0',
  () => console.info('[judge] Health server listening')
);

try {
  stopWorker = await startWorker();
  ready = true;
  console.info('[judge] Queue worker initialized');
} catch (error) {
  console.error('[judge] Worker startup failed:', error);
  process.exitCode = 1;
  server.close();
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;

  server.close();

  try {
    await stopWorker?.();
  } catch (error) {
    console.error('[judge] Shutdown error:', error);
  }
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
