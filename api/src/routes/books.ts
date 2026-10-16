import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { hashToken, newOpaqueToken, requireUser, roleAtLeast, roleInBook } from '../lib/auth.js';
import type { BookRole } from '../lib/auth.js';

const BOOK_TYPES = ['textbook-en', 'textbook-fa', 'fiction-fa'] as const;
const ROLES: BookRole[] = ['owner', 'author', 'editor', 'reviewer'];

export default async function bookRoutes(app: FastifyInstance) {
  // Library: books the current user is a member of.
  app.get('/api/books', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { rows } = await pool.query(
      `select b.id, b.slug, b.type, b.title, b.visibility, bm.role
         from books b
         join book_members bm on bm.book_id = b.id
        where bm.user_id = $1 and b.deleted_at is null
        order by b.updated_at desc`,
      [user.id],
    );
    return reply.send({ books: rows });
  });

  app.post<{ Body: { slug: string; type: string; title: string } }>('/api/books', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { slug, type, title } = request.body ?? {};
    if (!slug || !BOOK_TYPES.includes(type as any)) {
      return reply.code(400).send({ error: 'invalid_fields' });
    }
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) {
      return reply.code(400).send({ error: 'invalid_slug' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const created = await client.query(
        `insert into books (slug, type, title, created_by) values ($1, $2, $3, $4) returning id`,
        [slug, type, title ?? '', user.id],
      );
      const bookId = created.rows[0].id;
      await client.query(
        `insert into book_members (book_id, user_id, role) values ($1, $2, 'owner')`,
        [bookId, user.id],
      );
      await client.query(
        `insert into book_settings (book_id, data) values ($1, $2)`,
        [bookId, JSON.stringify({ title: title ?? '', lang: type === 'textbook-en' ? 'en' : 'fa', direction: type === 'textbook-en' ? 'ltr' : 'rtl', authors: [] })],
      );
      await client.query('commit');
      return reply.code(201).send({ id: bookId, slug });
    } catch (err: any) {
      await client.query('rollback');
      if (err.code === '23505') return reply.code(409).send({ error: 'slug_taken' });
      throw err;
    } finally {
      client.release();
    }
  });

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { bookId } = request.params;

    const role = await roleInBook(user.id, bookId);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    const { rows } = await pool.query(
      `select id, slug, type, title, visibility, authors_can_publish from books where id = $1 and deleted_at is null`,
      [bookId],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ book: rows[0], role });
  });

  app.patch<{ Params: { bookId: string }; Body: Record<string, unknown> }>(
    '/api/books/:bookId',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { bookId } = request.params;
      const role = await roleInBook(user.id, bookId);
      if (!roleAtLeast(role, 'author')) return reply.code(403).send({ error: 'forbidden' });

      const { title, visibility, authors_can_publish } = request.body ?? {};
      const fields: string[] = [];
      const values: unknown[] = [];
      if (title !== undefined) {
        values.push(title);
        fields.push(`title = $${values.length}`);
      }
      if (visibility !== undefined) {
        values.push(visibility);
        fields.push(`visibility = $${values.length}`);
      }
      if (authors_can_publish !== undefined && role === 'owner') {
        values.push(authors_can_publish);
        fields.push(`authors_can_publish = $${values.length}`);
      }
      if (fields.length === 0) return reply.send({ ok: true });

      values.push(bookId);
      await pool.query(`update books set ${fields.join(', ')}, updated_at = now() where id = $${values.length}`, values);
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/members', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    const { rows } = await pool.query(
      `select u.id, u.name, u.email, u.avatar_url, u.color, bm.role
         from book_members bm join users u on u.id = bm.user_id
        where bm.book_id = $1 order by bm.created_at asc`,
      [request.params.bookId],
    );
    return reply.send({ members: rows });
  });

  app.post<{ Params: { bookId: string }; Body: { email: string; role: BookRole } }>(
    '/api/books/:bookId/invites',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'owner')) return reply.code(403).send({ error: 'forbidden' });

      const { email, role: invitedRole } = request.body ?? {};
      if (!email || !ROLES.includes(invitedRole)) return reply.code(400).send({ error: 'invalid_fields' });

      const token = newOpaqueToken();
      const normalizedEmail = email.trim().toLowerCase();
      const existingUser = await pool.query('select id from users where email = $1', [normalizedEmail]);

      await pool.query(
        `insert into auth_links (token_hash, kind, email, user_id, book_id, role, created_by, expires_at)
         values ($1, 'invite_book', $2, $3, $4, $5, $6, now() + interval '14 days')`,
        [hashToken(token), normalizedEmail, existingUser.rows[0]?.id ?? null, request.params.bookId, invitedRole, user.id],
      );

      return reply.send({ token });
    },
  );

  // Called after a book invite link is opened: if the visitor is already
  // signed in as the invited user (or as a brand-new account just created
  // via /api/auth/consume-link), this attaches the membership row.
  app.post<{ Body: { token: string } }>('/api/invites/accept', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { token } = request.body ?? {};
    if (!token) return reply.code(400).send({ error: 'missing_token' });

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select id, email, book_id, role from auth_links
          where token_hash = $1 and kind = 'invite_book' and used_at is null and expires_at > now()
          for update`,
        [hashToken(token)],
      );
      const link = rows[0];
      if (!link) {
        await client.query('rollback');
        return reply.code(400).send({ error: 'invalid_or_expired_link' });
      }
      if (link.email !== user.email) {
        await client.query('rollback');
        return reply.code(403).send({ error: 'wrong_account' });
      }

      await client.query(
        `insert into book_members (book_id, user_id, role) values ($1, $2, $3)
         on conflict (book_id, user_id) do update set role = excluded.role`,
        [link.book_id, user.id, link.role],
      );
      await client.query('update auth_links set used_at = now() where id = $1', [link.id]);
      await client.query('commit');
      return reply.send({ ok: true, bookId: link.book_id });
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  });

  app.patch<{ Params: { bookId: string; userId: string }; Body: { role: BookRole } }>(
    '/api/books/:bookId/members/:userId',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'owner')) return reply.code(403).send({ error: 'forbidden' });

      const { role: newRole } = request.body ?? {};
      if (!ROLES.includes(newRole)) return reply.code(400).send({ error: 'invalid_role' });

      await pool.query('update book_members set role = $1 where book_id = $2 and user_id = $3', [
        newRole,
        request.params.bookId,
        request.params.userId,
      ]);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { bookId: string; userId: string } }>(
    '/api/books/:bookId/members/:userId',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'owner')) return reply.code(403).send({ error: 'forbidden' });
      if (request.params.userId === user.id) return reply.code(400).send({ error: 'cannot_remove_self' });

      await pool.query('delete from book_members where book_id = $1 and user_id = $2', [
        request.params.bookId,
        request.params.userId,
      ]);
      return reply.send({ ok: true });
    },
  );
}
