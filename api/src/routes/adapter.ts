import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { requireUser, roleAtLeast, roleInBook } from '../lib/auth.js';
import { subscribeChanges, publishChange } from '../lib/events.js';
import {
  blockRowToDoc,
  docToBlockColumns,
  docToSectionColumns,
  sectionRowToDoc,
} from '../lib/docShapes.js';

type Collection = 'sections' | 'blocks';

function newDocId(): string {
  return 'n' + randomBytes(6).toString('base64url').toLowerCase();
}

export default async function adapterRoutes(app: FastifyInstance) {
  // ---- collections: full dump, client does its own where()/orderBy() ----
  app.get<{ Params: { bookId: string; name: Collection } }>(
    '/api/books/:bookId/collections/:name',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!role) return reply.code(404).send({ error: 'not_found' });

      const { name, bookId } = request.params;
      if (name !== 'sections' && name !== 'blocks') return reply.code(400).send({ error: 'unknown_collection' });

      const { rows } = await pool.query(
        `select * from ${name} where book_id = $1 and deleted_at is null`,
        [bookId],
      );
      const docs = rows.map((row) => ({
        id: row.id,
        version: row.version,
        data: name === 'sections' ? sectionRowToDoc(row) : blockRowToDoc(row),
      }));
      return reply.send({ docs });
    },
  );

  app.post<{ Params: { bookId: string; name: Collection }; Body: Record<string, unknown> }>(
    '/api/books/:bookId/collections/:name',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const { name, bookId } = request.params;
      if (name !== 'blocks') return reply.code(400).send({ error: 'use_doc_put_for_this_collection' });

      const id = newDocId();
      const cols = docToBlockColumns(request.body as any);
      await pool.query(
        `insert into blocks (book_id, id, section, "order", type, fields, voice, style, version, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
        [bookId, id, cols.section, cols.order, cols.type, cols.fields, cols.voice, cols.style, user.id],
      );
      publishChange(bookId, { collection: 'blocks', id, version: 1, byUserId: user.id, data: cols });
      return reply.code(201).send({ id, version: 1 });
    },
  );

  // ---- single docs: sections/:id, blocks/:id, settings/book ----
  app.get<{ Params: { bookId: string; name: string; id: string } }>(
    '/api/books/:bookId/docs/:name/:id',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!role) return reply.code(404).send({ error: 'not_found' });

      const doc = await readDoc(request.params.bookId, request.params.name, request.params.id);
      if (!doc) return reply.code(404).send({ error: 'not_found' });
      return reply.send(doc);
    },
  );

  app.put<{ Params: { bookId: string; name: string; id: string }; Body: Record<string, unknown> }>(
    '/api/books/:bookId/docs/:name/:id',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { bookId, name, id } = request.params;
      const role = await roleInBook(user.id, bookId);
      const minRole = name === 'settings' ? 'author' : 'editor';
      if (!roleAtLeast(role, minRole)) return reply.code(403).send({ error: 'forbidden' });

      const expectedVersion = headerVersion(request);
      const result = await setDoc(bookId, name, id, request.body ?? {}, user.id, expectedVersion);
      if (result.conflict) return reply.code(409).send({ error: 'version_conflict', current: result.current });

      publishChange(bookId, {
        collection: result.collection!,
        id,
        version: result.version!,
        byUserId: user.id,
        data: result.data,
      });
      return reply.send({ ok: true, version: result.version });
    },
  );

  app.patch<{ Params: { bookId: string; name: string; id: string }; Body: Record<string, unknown> }>(
    '/api/books/:bookId/docs/:name/:id',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { bookId, name, id } = request.params;
      const role = await roleInBook(user.id, bookId);
      const minRole = name === 'settings' ? 'author' : 'editor';
      if (!roleAtLeast(role, minRole)) return reply.code(403).send({ error: 'forbidden' });

      const expectedVersion = headerVersion(request);
      const result = await updateDoc(bookId, name, id, request.body ?? {}, user.id, expectedVersion);
      if (result.conflict) return reply.code(409).send({ error: 'version_conflict', current: result.current });
      if (result.notFound) return reply.code(404).send({ error: 'not_found' });

      publishChange(bookId, {
        collection: result.collection!,
        id,
        version: result.version!,
        byUserId: user.id,
        data: result.data,
      });
      return reply.send({ ok: true, version: result.version });
    },
  );

  app.delete<{ Params: { bookId: string; name: string; id: string } }>(
    '/api/books/:bookId/docs/:name/:id',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { bookId, name, id } = request.params;
      const role = await roleInBook(user.id, bookId);
      if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });
      if (name !== 'sections' && name !== 'blocks') return reply.code(400).send({ error: 'unknown_collection' });

      if (name === 'blocks') {
        await snapshotBlockHistory(bookId, id, user.id);
      }
      const { rowCount } = await pool.query(
        `update ${name} set deleted_at = now() where book_id = $1 and id = $2 and deleted_at is null`,
        [bookId, id],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'not_found' });

      publishChange(bookId, { collection: name, id, version: -1, deleted: true, byUserId: user.id });
      return reply.send({ ok: true });
    },
  );

  // ---- live updates (SSE) ----
  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/events', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!role) return reply.code(404).send({ error: 'not_found' });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    const unsubscribe = subscribeChanges(request.params.bookId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ---- trash (soft-deleted blocks) ----
  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/trash/blocks', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const role = await roleInBook(user.id, request.params.bookId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await pool.query(
      `select id, section, type, fields, deleted_at from blocks
        where book_id = $1 and deleted_at is not null order by deleted_at desc limit 200`,
      [request.params.bookId],
    );
    return reply.send({ blocks: rows });
  });

  app.post<{ Params: { bookId: string; id: string } }>(
    '/api/books/:bookId/trash/blocks/:id/restore',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const { rowCount } = await pool.query(
        `update blocks set deleted_at = null, version = version + 1 where book_id = $1 and id = $2`,
        [request.params.bookId, request.params.id],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'not_found' });
      publishChange(request.params.bookId, {
        collection: 'blocks',
        id: request.params.id,
        version: 0,
        byUserId: user.id,
      });
      return reply.send({ ok: true });
    },
  );

  // ---- block history ----
  app.get<{ Params: { bookId: string; id: string } }>(
    '/api/books/:bookId/blocks/:id/history',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!role) return reply.code(404).send({ error: 'not_found' });

      const { rows } = await pool.query(
        `select id, fields, voice, style, "order", section, type, version, changed_by, changed_at
           from block_history where book_id = $1 and block_id = $2 order by changed_at desc limit 50`,
        [request.params.bookId, request.params.id],
      );
      return reply.send({ history: rows });
    },
  );

  app.post<{ Params: { bookId: string; id: string }; Body: { historyId: string } }>(
    '/api/books/:bookId/blocks/:id/restore',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      const { rows } = await pool.query(
        `select fields, voice, style, "order", section, type from block_history
          where id = $1 and book_id = $2 and block_id = $3`,
        [request.body.historyId, request.params.bookId, request.params.id],
      );
      const snapshot = rows[0];
      if (!snapshot) return reply.code(404).send({ error: 'not_found' });

      await snapshotBlockHistory(request.params.bookId, request.params.id, user.id);
      const updated = await pool.query(
        `update blocks set section = $1, type = $2, "order" = $3, fields = $4, voice = $5, style = $6,
                version = version + 1, updated_by = $7, updated_at = now()
          where book_id = $8 and id = $9 returning version`,
        [
          snapshot.section,
          snapshot.type,
          snapshot.order,
          snapshot.fields,
          snapshot.voice,
          snapshot.style,
          user.id,
          request.params.bookId,
          request.params.id,
        ],
      );
      publishChange(request.params.bookId, {
        collection: 'blocks',
        id: request.params.id,
        version: updated.rows[0].version,
        byUserId: user.id,
      });
      return reply.send({ ok: true });
    },
  );

  // ---- comments ----
  app.get<{ Params: { bookId: string }; Querystring: { blockId?: string } }>(
    '/api/books/:bookId/comments',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!role) return reply.code(404).send({ error: 'not_found' });

      const { blockId } = request.query;
      const { rows } = blockId
        ? await pool.query(
            `select c.id, c.block_id, c.text, c.resolved, c.created_at, u.name as author_name
               from comments c join users u on u.id = c.author_id
              where c.book_id = $1 and c.block_id = $2 order by c.created_at asc`,
            [request.params.bookId, blockId],
          )
        : await pool.query(
            `select c.id, c.block_id, c.text, c.resolved, c.created_at, u.name as author_name
               from comments c join users u on u.id = c.author_id
              where c.book_id = $1 order by c.created_at asc`,
            [request.params.bookId],
          );
      return reply.send({ comments: rows });
    },
  );

  app.post<{ Params: { bookId: string }; Body: { blockId: string; text: string } }>(
    '/api/books/:bookId/comments',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!role) return reply.code(404).send({ error: 'not_found' }); // reviewers may comment too

      const { blockId, text } = request.body ?? {};
      if (!blockId || !text?.trim()) return reply.code(400).send({ error: 'invalid_fields' });

      const { rows } = await pool.query(
        `insert into comments (book_id, block_id, author_id, text) values ($1, $2, $3, $4) returning id`,
        [request.params.bookId, blockId, user.id, text.trim()],
      );
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  app.patch<{ Params: { bookId: string; commentId: string }; Body: { resolved: boolean } }>(
    '/api/books/:bookId/comments/:commentId',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const role = await roleInBook(user.id, request.params.bookId);
      if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'forbidden' });

      await pool.query('update comments set resolved = $1, updated_at = now() where id = $2 and book_id = $3', [
        !!request.body?.resolved,
        request.params.commentId,
        request.params.bookId,
      ]);
      return reply.send({ ok: true });
    },
  );
}

function headerVersion(request: { headers: Record<string, unknown> }): number | null {
  const raw = request.headers['x-doc-version'];
  if (typeof raw !== 'string' || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function readDoc(bookId: string, name: string, id: string) {
  if (name === 'settings' && id === 'book') {
    const { rows } = await pool.query('select data, version from book_settings where book_id = $1', [bookId]);
    if (!rows[0]) return null;
    return { data: rows[0].data, version: rows[0].version };
  }
  if (name !== 'sections' && name !== 'blocks') return null;
  const { rows } = await pool.query(`select * from ${name} where book_id = $1 and id = $2 and deleted_at is null`, [
    bookId,
    id,
  ]);
  if (!rows[0]) return null;
  return {
    data: name === 'sections' ? sectionRowToDoc(rows[0]) : blockRowToDoc(rows[0]),
    version: rows[0].version,
  };
}

async function snapshotBlockHistory(bookId: string, blockId: string, changedBy: string) {
  await pool.query(
    `insert into block_history (book_id, block_id, section, type, "order", fields, voice, style, version, changed_by)
     select book_id, id, section, type, "order", fields, voice, style, version, $2
       from blocks where book_id = $1 and id = $3`,
    [bookId, changedBy, blockId],
  );
}

type WriteResult = {
  conflict?: boolean;
  notFound?: boolean;
  current?: { data: unknown; version: number };
  version?: number;
  collection?: 'sections' | 'blocks' | 'settings';
  data?: unknown;
};

async function setDoc(
  bookId: string,
  name: string,
  id: string,
  data: Record<string, unknown>,
  userId: string,
  expectedVersion: number | null,
): Promise<WriteResult> {
  if (name === 'settings' && id === 'book') {
    return setSettings(bookId, data, userId, expectedVersion);
  }
  if (name !== 'sections' && name !== 'blocks') return { notFound: true };

  const existing = await pool.query(`select version from ${name} where book_id = $1 and id = $2`, [bookId, id]);
  if (existing.rows[0]) {
    if (expectedVersion !== null && existing.rows[0].version !== expectedVersion) {
      const current = await readDoc(bookId, name, id);
      return { conflict: true, current: current ?? undefined };
    }
    if (name === 'blocks') await snapshotBlockHistory(bookId, id, userId);
  }

  const newVersion = (existing.rows[0]?.version ?? 0) + 1;

  if (name === 'sections') {
    const cols = docToSectionColumns(data as any);
    await pool.query(
      `insert into sections (book_id, id, chapter, title, num, "order", status, notes, version, updated_by, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null)
       on conflict (book_id, id) do update set
         chapter = excluded.chapter, title = excluded.title, num = excluded.num, "order" = excluded.order,
         status = excluded.status, notes = excluded.notes, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = now(), deleted_at = null`,
      [bookId, id, cols.chapter, cols.title, cols.num, cols.order, cols.status, cols.notes, newVersion, userId],
    );
  } else {
    const cols = docToBlockColumns(data as any);
    await pool.query(
      `insert into blocks (book_id, id, section, type, "order", fields, voice, style, version, updated_by, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null)
       on conflict (book_id, id) do update set
         section = excluded.section, type = excluded.type, "order" = excluded.order, fields = excluded.fields,
         voice = excluded.voice, style = excluded.style, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = now(), deleted_at = null`,
      [bookId, id, cols.section, cols.type, cols.order, cols.fields, cols.voice, cols.style, newVersion, userId],
    );
  }

  return { version: newVersion, collection: name, data };
}

async function updateDoc(
  bookId: string,
  name: string,
  id: string,
  patch: Record<string, unknown>,
  userId: string,
  expectedVersion: number | null,
): Promise<WriteResult> {
  if (name === 'settings' && id === 'book') {
    return updateSettings(bookId, patch, userId, expectedVersion);
  }
  if (name !== 'sections' && name !== 'blocks') return { notFound: true };

  const existing = await pool.query(`select * from ${name} where book_id = $1 and id = $2 and deleted_at is null`, [
    bookId,
    id,
  ]);
  if (!existing.rows[0]) return { notFound: true };
  if (expectedVersion !== null && existing.rows[0].version !== expectedVersion) {
    const current = await readDoc(bookId, name, id);
    return { conflict: true, current: current ?? undefined };
  }

  if (name === 'blocks') await snapshotBlockHistory(bookId, id, userId);

  const merged =
    name === 'sections'
      ? { ...sectionRowToDoc(existing.rows[0]), ...patch }
      : { ...blockRowToDoc(existing.rows[0]), ...patch };

  return setDoc(bookId, name, id, merged, userId, null).then((r) => ({ ...r, collection: name }));
}

async function setSettings(
  bookId: string,
  data: Record<string, unknown>,
  userId: string,
  expectedVersion: number | null,
): Promise<WriteResult> {
  const existing = await pool.query('select version from book_settings where book_id = $1', [bookId]);
  if (existing.rows[0] && expectedVersion !== null && existing.rows[0].version !== expectedVersion) {
    const current = await readDoc(bookId, 'settings', 'book');
    return { conflict: true, current: current ?? undefined };
  }
  const newVersion = (existing.rows[0]?.version ?? 0) + 1;
  await pool.query(
    `insert into book_settings (book_id, data, version, updated_by)
     values ($1, $2, $3, $4)
     on conflict (book_id) do update set data = excluded.data, version = excluded.version,
       updated_by = excluded.updated_by, updated_at = now()`,
    [bookId, data, newVersion, userId],
  );
  return { version: newVersion, collection: 'settings', data };
}

async function updateSettings(
  bookId: string,
  patch: Record<string, unknown>,
  userId: string,
  expectedVersion: number | null,
): Promise<WriteResult> {
  const existing = await pool.query('select data, version from book_settings where book_id = $1', [bookId]);
  if (!existing.rows[0]) return { notFound: true };
  if (expectedVersion !== null && existing.rows[0].version !== expectedVersion) {
    return { conflict: true, current: { data: existing.rows[0].data, version: existing.rows[0].version } };
  }
  const merged = { ...existing.rows[0].data, ...patch };
  return setSettings(bookId, merged, userId, null);
}
