import { app } from './app';
import { db, one } from './db';
import { seed } from './seed';
import { processPendingSubmissionsAsync } from './eta';

if (process.env.NODE_ENV !== 'test' && !one('SELECT id FROM users LIMIT 1')) {
  await seed(false);
}

const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () =>
  console.log(`Orqiva API listening on 0.0.0.0:${process.env.PORT || 3001}`),
);

// Background e-invoice outbox: drains due ETA submissions without blocking checkout.
// Failures are retried with exponential backoff by the outbox itself.
let etaTimer: NodeJS.Timeout | undefined;
let etaRunning = false;
if (process.env.NODE_ENV !== 'test') {
  etaTimer = setInterval(() => {
    // One run at a time, so a slow ETA answer never stacks overlapping batches.
    if (etaRunning) return;
    etaRunning = true;
    processPendingSubmissionsAsync(20)
      .catch((error) => console.error('ETA outbox worker error', error))
      .finally(() => {
        etaRunning = false;
      });
  }, 60 * 1000);
  etaTimer.unref();
}

for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      if (etaTimer) clearInterval(etaTimer);
      db.close();
      process.exit(0);
    }),
  );
