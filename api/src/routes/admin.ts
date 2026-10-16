import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { hashToken, newOpaqueToken, requireUser } from '../lib/auth.js';

export default async function adminRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string } }>('/api/admin/invite-platform-user', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'forbidden' });

    const email = request.body?.email?.trim().toLowerCase();
    if (!email) return reply.code(400).send({ error: 'missing_email' });

    const token = newOpaqueToken();
    await pool.query(
      `insert into auth_links (token_hash, kind, email, created_by, expires_at)
       values ($1, 'invite_platform', $2, $3, now() + interval '14 days')`,
      [hashToken(token), email, user.id],
    );
    return reply.send({ token });
  });

  app.get('/api/admin/users', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await pool.query('select id, email, name, is_admin, created_at from users order by created_at asc');
    return reply.send({ users: rows });
  });
}
