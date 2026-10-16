// One-off bootstrap: create the first admin/owner account directly in the
// database. Run once per environment: `node dist/seed-admin.js <email> <name>`.
// Prints a one-time link (as a reset-password auth_link) to set the password;
// there is no SMTP configured, so this link must be handed over manually.
import { hashToken, newOpaqueToken } from './lib/auth.js';
import { pool } from './db/pool.js';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('usage: seed-admin.js <email> <name>');
    process.exit(1);
  }

  const placeholderPassword = randomBytes(24).toString('base64url');
  const passwordHash = await argon2.hash(placeholderPassword);

  const existing = await pool.query('select id from users where email = $1', [email.toLowerCase()]);
  let userId: string;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await pool.query('update users set is_admin = true where id = $1', [userId]);
    console.log(`user already existed (${userId}); marked as admin.`);
  } else {
    const created = await pool.query(
      `insert into users (email, password_hash, name, is_admin) values ($1, $2, $3, true) returning id`,
      [email.toLowerCase(), passwordHash, name],
    );
    userId = created.rows[0].id;
    console.log(`created admin user ${userId}`);
  }

  const token = newOpaqueToken();
  await pool.query(
    `insert into auth_links (token_hash, kind, user_id, expires_at) values ($1, 'reset_password', $2, now() + interval '7 days')`,
    [hashToken(token), userId],
  );
  console.log(`one-time set-password token: ${token}`);
  console.log(`open the studio login page and use "set password" with this token.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
