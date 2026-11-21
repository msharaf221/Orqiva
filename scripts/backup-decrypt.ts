/**
 * Decrypts a cloud backup made by the backup add-on.
 *   ORQIVA_BACKUP_PASSPHRASE=... npm run backup:decrypt -- file.db.enc restored.db
 * To restore: stop the server, replace the database file (DATABASE_PATH) with the result,
 * start the server.
 */
import { decryptFile } from '../server/modules/backup/crypto';

const [src, dest] = process.argv.slice(2);
const pass = process.env.ORQIVA_BACKUP_PASSPHRASE;
if (!src || !dest || !pass) {
  console.error('usage: ORQIVA_BACKUP_PASSPHRASE=... backup:decrypt <file.db.enc> <output.db>');
  process.exit(1);
}
await decryptFile(src, dest, pass);
console.log('Decrypted to', dest);
