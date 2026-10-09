import { db, migrate } from './db';
migrate();
console.log('Database schema is up to date.');
db.close();
