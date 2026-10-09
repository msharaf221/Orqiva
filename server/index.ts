import { app } from './app';
import { db } from './db';
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
