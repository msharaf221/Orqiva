import { app } from './app';
import { db, one } from './db';
import { seed } from './seed';
import { processPendingSubmissionsAsync } from './eta';
import { runScheduledBackup } from './modules/backup/service';
import { pruneIdempotencyKeys } from './idempotency';
import { isAddonEnabled } from './addons/registry';

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

// Backup add-on: take a daily copy when the add-on is enabled (checked hourly).
let backupTimer: NodeJS.Timeout | undefined;
if (process.env.NODE_ENV !== 'test') {
  const tick = () => {
    if (!isAddonEnabled('backup')) return;
    runScheduledBackup().catch((error) => console.error('Backup worker error', error));
  };
  setTimeout(tick, 60_000).unref();
  backupTimer = setInterval(tick, 3_600_000);
  backupTimer.unref();
}

// Keep the retry-safety table small: drop idempotency keys older than 30 days, once a day.
let pruneTimer: NodeJS.Timeout | undefined;
if (process.env.NODE_ENV !== 'test') {
  const prune = () => {
    try {
      pruneIdempotencyKeys();
    } catch (error) {
      console.error('Idempotency prune error', error);
    }
  };
  setTimeout(prune, 120_000).unref();
  pruneTimer = setInterval(prune, 24 * 3_600_000);
  pruneTimer.unref();
}

for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      if (etaTimer) clearInterval(etaTimer);
      if (backupTimer) clearInterval(backupTimer);
      if (pruneTimer) clearInterval(pruneTimer);
      db.close();
      process.exit(0);
    }),
  );
