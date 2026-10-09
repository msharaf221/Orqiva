import { app } from './app';
import { db, one } from './db';
import { seed } from './seed';

if (process.env.NODE_ENV !== 'test' && !one('SELECT id FROM users LIMIT 1')) {
  await seed(false);
}

const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () =>
  console.log(`Orqiva API listening on 0.0.0.0:${process.env.PORT || 3001}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
