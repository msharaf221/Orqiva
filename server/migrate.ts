import { db, migrate } from './db';
import { runTaxFreeReset } from './tax_free_reset';
migrate();
runTaxFreeReset();
console.log('Database schema is up to date.');
db.close();
