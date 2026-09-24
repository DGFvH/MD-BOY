// Admin commands for self-hosters. Uses the same DATA_DIR as the server and is
// safe to run while the server is up.
//   node server/admin.js reset-password <email>
import { randomBytes } from 'node:crypto';
import { databaseFile, openDatabase } from './db.js';
import { hashPassword } from './auth.js';

const [command, email] = process.argv.slice(2);
if (command !== 'reset-password' || !email) {
  console.error('Usage: node server/admin.js reset-password <email>');
  process.exit(1);
}

const db = openDatabase(databaseFile());
const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.trim().toLowerCase());
if (!user) {
  console.error(`No account with the email ${email}.`);
  process.exit(1);
}
const password = randomBytes(12).toString('base64url');
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
db.close();
console.log(`New password for ${user.email}: ${password}`);
console.log('The account was signed out everywhere. Ask the user to change this password after signing in.');
