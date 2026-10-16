import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import {
  createSession,
  currentUser,
  destroySession,
  hashToken,
  newOpaqueToken,
  requireUser,
} from '../lib/auth.js';

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.send({ user: null });
    return reply.send({ user });
  });

  app.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'missing_fields' });

    const { rows } = await pool.query('select id, password_hash from users where email = $1', [
      email.trim().toLowerCase(),
    ]);
    const row = rows[0];
    if (!row) return reply.code(401).send({ error: 'invalid_credentials' });

    const ok = await argon2.verify(row.password_hash, password);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    await createSession(row.id, request.headers['user-agent'], reply);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply);
    return reply.send({ ok: true });
  });

  // Consume an admin-issued link: either accepting a brand-new-user platform
  // invite (sets name + password for the first time) or resetting a password.
  app.post<{ Body: { token: string; name?: string; password: string } }>(
    '/api/auth/consume-link',
    async (request, reply) => {
      const { token, name, password } = request.body ?? {};
      if (!token || !password) return reply.code(400).send({ error: 'missing_fields' });
      if (password.length < 8) return reply.code(400).send({ error: 'password_too_short' });

      const tokenHash = hashToken(token);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const { rows } = await client.query(
          `select id, kind, email, user_id, book_id, role from auth_links
            where token_hash = $1 and used_at is null and expires_at > now()
            for update`,
          [tokenHash],
        );
        const link = rows[0];
        if (!link) {
          await client.query('rollback');
          return reply.code(400).send({ error: 'invalid_or_expired_link' });
        }

        const passwordHash = await argon2.hash(password);
        let userId = link.user_id as string | null;

        if (link.kind === 'reset_password') {
          if (!userId) throw new Error('reset_password link missing user_id');
          await client.query('update users set password_hash = $1, updated_at = now() where id = $2', [
            passwordHash,
            userId,
          ]);
        } else if (link.kind === 'invite_platform' || link.kind === 'invite_book') {
          if (!link.email) throw new Error(`${link.kind} link missing email`);
          const existing = await client.query('select id from users where email = $1', [link.email]);
          if (existing.rows[0]) {
            userId = existing.rows[0].id;
            await client.query('update users set password_hash = $1, updated_at = now() where id = $2', [
              passwordHash,
              userId,
            ]);
          } else {
            const created = await client.query(
              `insert into users (email, password_hash, name, color)
               values ($1, $2, $3, $4) returning id`,
              [link.email, passwordHash, name?.trim() || link.email.split('@')[0], randomColor()],
            );
            userId = created.rows[0].id;
          }
          if (link.kind === 'invite_book') {
            await client.query(
              `insert into book_members (book_id, user_id, role) values ($1, $2, $3)
               on conflict (book_id, user_id) do update set role = excluded.role`,
              [link.book_id, userId, link.role],
            );
          }
        } else {
          await client.query('rollback');
          return reply.code(400).send({ error: 'unsupported_link_kind' });
        }

        await client.query('update auth_links set used_at = now() where id = $1', [link.id]);
        await client.query('commit');

        await createSession(userId!, request.headers['user-agent'], reply);
        return reply.send({ ok: true });
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // Owner/admin asks for a reset link for a user they manage; since no SMTP
  // is configured yet, the caller gets the raw link back to hand over manually.
  app.post<{ Body: { email: string } }>('/api/auth/request-reset-link', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'forbidden' });

    const { email } = request.body ?? {};
    const { rows } = await pool.query('select id from users where email = $1', [email?.trim().toLowerCase()]);
    if (!rows[0]) return reply.code(404).send({ error: 'no_such_user' });

    const token = newOpaqueToken();
    await pool.query(
      `insert into auth_links (token_hash, kind, user_id, created_by, expires_at)
       values ($1, 'reset_password', $2, $3, now() + interval '7 days')`,
      [hashToken(token), rows[0].id, user.id],
    );
    return reply.send({ token });
  });
}

function randomColor(): string {
  const palette = ['#2563eb', '#16a34a', '#d97706', '#be185d', '#7c3aed', '#0891b2'];
  return palette[Math.floor(Math.random() * palette.length)];
}
