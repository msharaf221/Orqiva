import { hash } from 'bcryptjs';
import { db, one, run, transaction } from './db';
import { audit } from './service';
const email = process.env.ADMIN_EMAIL || 'admin@orqiva.com';
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 10 || password.length > 128)
  throw new Error('Set ADMIN_PASSWORD to a new password (10–128 characters).');
const user = one<{ id: string; name: string }>(
  "SELECT id,name FROM users WHERE email=? AND role='ADMIN' AND active=1",
  email,
);
if (!user) throw new Error('Active administrator not found. Check ADMIN_EMAIL.');
const passwordHash = await hash(password, 12);
transaction(() => {
  run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, user.id);
  run('DELETE FROM sessions WHERE user_id=?', user.id);
  audit(user, 'إعادة تعيين كلمة المرور من الخادم', 'USER', user.id);
});
console.log('Administrator password reset. Existing sessions were revoked.');
db.close();
